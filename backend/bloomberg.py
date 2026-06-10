"""
Bloomberg session manager.

Manages a single persistent blpapi Session shared by both the EMSX and
reference-data services. Runs a background thread to drain events so that
request/response pairs and EMSX order-subscription updates are processed
without blocking the FastAPI event loop.

Usage:
    manager = BloombergManager()
    manager.start()          # call once on app startup
    manager.stop()           # call on app shutdown
"""

import blpapi
import threading
import queue
import logging
from datetime import datetime
from typing import Any

from .config import BBG_HOST, BBG_PORT, EMSX_SERVICE, REF_SERVICE

log = logging.getLogger(__name__)


class BloombergManager:
    def __init__(self) -> None:
        self._session: blpapi.Session | None = None
        self._emsx_svc: blpapi.Service | None = None
        self._refdata_svc: blpapi.Service | None = None

        # Maps a correlation id value → queue.Queue so callers can await responses
        self._pending: dict[Any, queue.Queue] = {}
        self._pending_lock = threading.Lock()

        # Cache of EMSX order state keyed by EMSX sequence number
        # Updated by the background event thread when subscription messages arrive
        self._order_cache: dict[int, dict] = {}
        self._order_lock = threading.Lock()

        self._running = False
        self._event_thread: threading.Thread | None = None
        self._cid_counter = 0
        self._cid_lock = threading.Lock()

        # Diagnostics: log the first subscription-data message type once, so we can
        # confirm order data is actually flowing (vs. a failed subscription).
        self._logged_sub_msgtype = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        options = blpapi.SessionOptions()
        options.setServerHost(BBG_HOST)
        options.setServerPort(BBG_PORT)

        self._session = blpapi.Session(options)
        if not self._session.start():
            raise RuntimeError("Bloomberg session failed to start. Is Bloomberg Terminal running?")

        if not self._session.openService(EMSX_SERVICE):
            raise RuntimeError(f"Failed to open {EMSX_SERVICE}")
        if not self._session.openService(REF_SERVICE):
            raise RuntimeError(f"Failed to open {REF_SERVICE}")

        self._emsx_svc = self._session.getService(EMSX_SERVICE)
        self._refdata_svc = self._session.getService(REF_SERVICE)

        self._subscribe_emsx_orders()

        self._running = True
        self._event_thread = threading.Thread(
            target=self._event_loop, name="bbg-events", daemon=True
        )
        self._event_thread.start()
        log.info("Bloomberg session started on %s:%d", BBG_HOST, BBG_PORT)

    def stop(self) -> None:
        self._running = False
        if self._session:
            self._session.stop()
        log.info("Bloomberg session stopped")

    @property
    def connected(self) -> bool:
        return self._session is not None and self._running

    # ------------------------------------------------------------------
    # EMSX order subscription
    # ------------------------------------------------------------------

    def _subscribe_emsx_orders(self) -> None:
        """Subscribe to all EMSX orders so fill updates flow into the cache."""
        subs = blpapi.SubscriptionList()
        fields = [
            "EMSX_SEQUENCE", "EMSX_STATUS", "EMSX_FILLED",
            "EMSX_AMOUNT", "EMSX_TICKER", "EMSX_SIDE",
            # Average fill price — populated as the order fills; used for the recap.
            "EMSX_AVG_PRICE",
            # For de-duplication: the EATrade OrderId is written to both
            # EMSX_ORDER_REF_ID and EMSX_NOTES; create-date scopes matches to today.
            "EMSX_ORDER_REF_ID", "EMSX_NOTES", "EMSX_ORDER_CREATE_DATE",
        ]
        # Fields must be passed as a list argument, NOT embedded in the topic string.
        subs.add(
            f"{EMSX_SERVICE}/order",
            fields,
            correlationId=blpapi.CorrelationId("emsx_orders"),
        )
        self._session.subscribe(subs)

    # ------------------------------------------------------------------
    # Background event loop
    # ------------------------------------------------------------------

    def _event_loop(self) -> None:
        while self._running:
            event = self._session.nextEvent(500)
            event_type = event.eventType()
            if event_type == blpapi.Event.TIMEOUT:
                continue
            for msg in event:
                try:
                    self._dispatch(event_type, msg)
                except Exception:
                    log.exception("Error dispatching Bloomberg event (eventType=%d)", event_type)

    def _dispatch(self, event_type: int, msg: blpapi.Message) -> None:
        # EMSX order-subscription data. We branch on the EVENT type, not the
        # message-type name: EMSX subscription-data messages do not carry a stable
        # messageType across API versions, so filtering by name (the old approach)
        # silently dropped every update and left the order cache empty. The only
        # thing we subscribe to is the EMSX order topic, so every SUBSCRIPTION_DATA
        # message is an order update; _handle_emsx_update guards on EMSX_SEQUENCE.
        if event_type == blpapi.Event.SUBSCRIPTION_DATA:
            if not self._logged_sub_msgtype:
                log.info("First EMSX subscription-data message type: %s", msg.messageType())
                self._logged_sub_msgtype = True
            self._handle_emsx_update(msg)
            return

        # Subscription lifecycle — surface a failed/terminated order subscription
        # (a failed topic resolve here is a reason the cache can stay empty).
        if event_type == blpapi.Event.SUBSCRIPTION_STATUS:
            msg_type = str(msg.messageType())
            if msg_type in ("SubscriptionFailure", "SubscriptionTerminated"):
                log.warning("EMSX subscription %s: %s", msg_type, msg)
            else:
                log.info("EMSX subscription status: %s", msg_type)
            return

        # Everything else (RESPONSE / PARTIAL_RESPONSE) — wake the waiting caller
        # keyed by correlation id.
        for cid in msg.correlationIds():
            val = cid.value()
            with self._pending_lock:
                q = self._pending.get(val)
            if q:
                q.put(msg)

    def _handle_emsx_update(self, msg: blpapi.Message) -> None:
        try:
            if not msg.hasElement("EMSX_SEQUENCE"):
                return  # Heartbeat or partial update — nothing to cache
            seq = msg.getElementAsInteger("EMSX_SEQUENCE")
            if seq == 0:
                return  # Bloomberg sometimes sends seq=0 for dummy/initial messages
            status = msg.getElementAsString("EMSX_STATUS")  if msg.hasElement("EMSX_STATUS")  else ""
            filled = msg.getElementAsInteger("EMSX_FILLED") if msg.hasElement("EMSX_FILLED") else 0
            amount = msg.getElementAsInteger("EMSX_AMOUNT") if msg.hasElement("EMSX_AMOUNT") else 0
            avg_price = msg.getElementAsFloat("EMSX_AVG_PRICE") if msg.hasElement("EMSX_AVG_PRICE") else 0.0
            ticker = msg.getElementAsString("EMSX_TICKER")  if msg.hasElement("EMSX_TICKER")  else ""
            # Subscription messages send EMSX_SIDE as a string ("BUY"/"SELL"), not an integer
            side_raw = msg.getElementAsString("EMSX_SIDE") if msg.hasElement("EMSX_SIDE") else "BUY"
            bs = side_raw if side_raw in ("BUY", "SELL") else ("SELL" if side_raw in ("2", "S") else "BUY")

            ref_id = msg.getElementAsString("EMSX_ORDER_REF_ID") if msg.hasElement("EMSX_ORDER_REF_ID") else ""
            notes  = msg.getElementAsString("EMSX_NOTES")        if msg.hasElement("EMSX_NOTES")        else ""
            create_date = (
                msg.getElementAsInteger("EMSX_ORDER_CREATE_DATE")
                if msg.hasElement("EMSX_ORDER_CREATE_DATE") else 0
            )

            with self._order_lock:
                is_new = seq not in self._order_cache
                self._order_cache[seq] = {
                    "emsxSequence": seq,
                    "status": status,
                    "filledAmount": filled,
                    "avgPrice": avg_price,
                    "lots": amount,
                    "ticker": ticker,
                    "bs": bs,
                    "refId": ref_id,
                    "notes": notes,
                    "createDate": create_date,
                }
                cache_size = len(self._order_cache)
            if is_new:
                log.info(
                    "Cached EMSX order seq=%d status=%s refId=%r notes=%r createDate=%s (cache size=%d)",
                    seq, status, ref_id, notes, create_date, cache_size,
                )
        except Exception:
            log.exception("Failed to parse EMSX update message")

    # ------------------------------------------------------------------
    # Request helpers
    # ------------------------------------------------------------------

    def _next_cid(self) -> int:
        with self._cid_lock:
            self._cid_counter += 1
            return self._cid_counter

    def send_request_sync(self, request: blpapi.Request, timeout: float = 30.0) -> blpapi.Message:
        """Send a request and block until the response arrives (or timeout)."""
        cid_val = self._next_cid()
        cid = blpapi.CorrelationId(cid_val)
        q: queue.Queue = queue.Queue()

        with self._pending_lock:
            self._pending[cid_val] = q

        try:
            self._session.sendRequest(request, correlationId=cid)
            msg = q.get(timeout=timeout)
            return msg
        except queue.Empty:
            raise TimeoutError(f"Bloomberg request timed out after {timeout}s")
        finally:
            with self._pending_lock:
                self._pending.pop(cid_val, None)

    # ------------------------------------------------------------------
    # Public accessors
    # ------------------------------------------------------------------

    @property
    def emsx_service(self) -> blpapi.Service:
        assert self._emsx_svc, "Bloomberg session not started"
        return self._emsx_svc

    @property
    def refdata_service(self) -> blpapi.Service:
        assert self._refdata_svc, "Bloomberg session not started"
        return self._refdata_svc

    def get_cached_orders(self, sequences: list[int]) -> list[dict]:
        with self._order_lock:
            return [self._order_cache[s] for s in sequences if s in self._order_cache]

    def get_existing_order_refs(self, today_only: bool = True) -> set[str]:
        """
        Return the set of order references currently in the EMSX blotter, used to
        de-duplicate re-pasted EATrade orders. The EATrade OrderId is written to
        both EMSX_ORDER_REF_ID and EMSX_NOTES, so both are collected.

        When today_only is True, orders whose EMSX_ORDER_CREATE_DATE is known and
        not today are excluded. Orders with an unknown create-date (0) are kept,
        so de-dup still works if that field isn't delivered by the subscription.
        """
        today = int(datetime.now().strftime("%Y%m%d"))
        refs: set[str] = set()
        excluded_by_date = 0
        with self._order_lock:
            cached_count = len(self._order_cache)
            for o in self._order_cache.values():
                cd = o.get("createDate") or 0
                if today_only and cd and cd != today:
                    excluded_by_date += 1
                    continue
                for key in ("refId", "notes"):
                    val = (o.get(key) or "").strip()
                    if val:
                        refs.add(val)
        log.info(
            "Order-ref lookup: %d cached orders, %d refs collected, "
            "%d excluded by create-date (today=%d, today_only=%s)",
            cached_count, len(refs), excluded_by_date, today, today_only,
        )
        return refs

    def debug_cache_snapshot(self) -> dict:
        """Dump the EMSX order cache for diagnosing de-duplication. Read-only."""
        today = int(datetime.now().strftime("%Y%m%d"))
        with self._order_lock:
            orders = [
                {
                    "emsxSequence": o.get("emsxSequence"),
                    "status": o.get("status"),
                    "filledAmount": o.get("filledAmount"),
                    "refId": o.get("refId"),
                    "notes": o.get("notes"),
                    "createDate": o.get("createDate"),
                }
                for o in self._order_cache.values()
            ]
        return {"today": today, "count": len(orders), "orders": orders}


# Singleton instance — imported by main.py and emsx.py
bbg = BloombergManager()

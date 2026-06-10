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
import re
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

        # Order-subscription fields. Kept as state so that if EMSX rejects one as
        # invalid, we can drop it and re-subscribe (self-healing — see
        # _subscribe_emsx_orders / the SubscriptionFailure handler).
        self._sub_fields: list[str] = []
        self._sub_attempt = 0

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
        # IMPORTANT: every field here must be a valid *subscription* field on the
        # order topic. If even one is not, EMSX rejects the ENTIRE subscription
        # (SubscriptionFailure: "Invalid field name detected") and no orders ever
        # reach the cache. Note the subscription schema differs from the CreateOrder
        # *request* schema — EMSX_ORDER_REF_ID is settable on an order but is NOT a
        # valid subscription field (and is truncated in the blotter besides), so we
        # de-dup on EMSX_NOTES, which carries the full EATrade OrderId.
        #
        # As a safety net, an invalid field reported via SubscriptionFailure is
        # dropped and the subscription re-issued (see _resubscribe_dropping_field).
        self._sub_fields = [
            "EMSX_SEQUENCE", "EMSX_STATUS", "EMSX_FILLED",
            "EMSX_AMOUNT", "EMSX_TICKER", "EMSX_SIDE",
            # Average fill price — populated as the order fills; used for the recap.
            "EMSX_AVG_PRICE",
            # Full EATrade OrderId for de-duplication.
            "EMSX_NOTES",
        ]
        self._issue_order_subscription()

    def _issue_order_subscription(self) -> None:
        """(Re)subscribe to the EMSX order topic using the current field list."""
        self._sub_attempt += 1
        subs = blpapi.SubscriptionList()
        # Fields must be passed as a list argument, NOT embedded in the topic string.
        subs.add(
            f"{EMSX_SERVICE}/order",
            self._sub_fields,
            # Fresh correlation id per attempt so a re-subscribe never collides with
            # the failed one. Dispatch routes order data by event type, not by cid.
            correlationId=blpapi.CorrelationId(f"emsx_orders_{self._sub_attempt}"),
        )
        log.info("Subscribing to EMSX orders with fields: %s", self._sub_fields)
        self._session.subscribe(subs)

    def _resubscribe_dropping_field(self, bad_field: str) -> None:
        """Drop an EMSX-rejected field and re-subscribe so the rest still flow."""
        if bad_field not in self._sub_fields:
            return  # not ours / already handled — avoid an infinite re-subscribe loop
        self._sub_fields = [f for f in self._sub_fields if f != bad_field]
        if not self._sub_fields:
            log.error("All EMSX subscription fields were rejected; order cache will stay empty")
            return
        log.warning("Dropping invalid EMSX subscription field %r and re-subscribing", bad_field)
        self._issue_order_subscription()

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
                # "Invalid field name detected. Field=|EMSX_XXX|" — drop it and retry.
                m = re.search(r"Field=\|([^|]+)\|", str(msg))
                if m:
                    self._resubscribe_dropping_field(m.group(1).strip())
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

            notes = msg.getElementAsString("EMSX_NOTES") if msg.hasElement("EMSX_NOTES") else ""

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
                    "notes": notes,
                }
                cache_size = len(self._order_cache)
            if is_new:
                log.info(
                    "Cached EMSX order seq=%d status=%s notes=%r (cache size=%d)",
                    seq, status, notes, cache_size,
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

    def get_existing_order_refs(self) -> set[str]:
        """
        Return the EATrade OrderIds currently in the EMSX blotter, used to
        de-duplicate re-pasted orders. The OrderId is stored in EMSX_NOTES — the
        full value (EMSX_ORDER_REF_ID is truncated in the blotter and is not a
        valid subscription field). EATrade OrderIds are unique GUIDs, so a match
        means the order has already been staged, regardless of day or status.
        """
        refs: set[str] = set()
        with self._order_lock:
            cached_count = len(self._order_cache)
            for o in self._order_cache.values():
                val = (o.get("notes") or "").strip()
                if val:
                    refs.add(val)
        log.info(
            "Order-ref lookup: %d cached orders, %d OrderIds (EMSX_NOTES) collected",
            cached_count, len(refs),
        )
        return refs

    def debug_cache_snapshot(self) -> dict:
        """Dump the EMSX order cache for diagnosing de-duplication. Read-only."""
        with self._order_lock:
            orders = [
                {
                    "emsxSequence": o.get("emsxSequence"),
                    "status": o.get("status"),
                    "filledAmount": o.get("filledAmount"),
                    "notes": o.get("notes"),
                }
                for o in self._order_cache.values()
            ]
        return {"count": len(orders), "orders": orders}


# Singleton instance — imported by main.py and emsx.py
bbg = BloombergManager()

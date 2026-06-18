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
import time
from typing import Any

from .config import BBG_HOST, BBG_PORT, EMSX_SERVICE, EMSX_TEAM, REF_SERVICE

log = logging.getLogger(__name__)

# How long to treat the EMSX order cache as still warming up after the
# subscription is issued, mirroring the dedup-retry pattern (2.5s/4s/6s delays)
# used elsewhere to account for Bloomberg subscription lag. A freshly-opened
# blotter with zero orders never sends a message, so "has data arrived" isn't a
# reliable ready signal on its own — a fixed grace period is used instead.
EMSX_WARMUP_SECONDS = 6.0


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

        # Set once, the first time the EMSX order subscription is issued — used
        # by `emsx_ready` to report a warmup period to the frontend rather than
        # field-drop re-subscribes resetting the clock.
        self._subscribed_at: float | None = None

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

    @property
    def emsx_ready(self) -> bool:
        """True once connected AND the EMSX_WARMUP_SECONDS grace period since
        subscribing has elapsed — see EMSX_WARMUP_SECONDS for why this is
        time-based rather than waiting for the first order message."""
        if not self.connected or self._subscribed_at is None:
            return False
        return (time.time() - self._subscribed_at) >= EMSX_WARMUP_SECONDS

    # ------------------------------------------------------------------
    # EMSX order subscription
    # ------------------------------------------------------------------

    def _subscribe_emsx_orders(self) -> None:
        """Subscribe to all EMSX orders so fill updates flow into the cache."""
        if self._subscribed_at is None:
            self._subscribed_at = time.time()
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
            # Order date (YYYYMMDD). EMSX_DATE is the subscribable order-date field
            # (confirmed via the subscription event schema). The CreateOrder request
            # schema's date fields — EMSX_ORDER_CREATE_DATE, EMSX_AS_OF_DATE, and the
            # *_TIME_MICROSEC forms — are NOT subscribable. Drives the today-only
            # pick-up filter and the recap Date column.
            "EMSX_DATE",
        ]
        self._issue_order_subscription()

    def _issue_order_subscription(self) -> None:
        """(Re)subscribe to the EMSX order topic using the current field list."""
        self._sub_attempt += 1
        subs = blpapi.SubscriptionList()
        # ;team=NAME scopes the subscription to the full team blotter so orders
        # from all team members are visible. UAT=FCMTEST, PROD=WFC_FUTURES.
        # Fields are passed as a separate list rather than embedded in the topic
        # string — both forms are equivalent per Bloomberg EMSX API docs.
        subs.add(
            f"{EMSX_SERVICE}/order;team={EMSX_TEAM}",
            self._sub_fields,
            # Fresh correlation id per attempt so a re-subscribe never collides with
            # the failed one. Dispatch routes order data by event type, not by cid.
            correlationId=blpapi.CorrelationId(f"emsx_orders_{self._sub_attempt}"),
        )
        log.info("Subscribing to EMSX orders (team=%s) with fields: %s", EMSX_TEAM, self._sub_fields)
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

            # Bloomberg sends a full "paint" on initial subscribe, then delta
            # messages that often carry only the fields that changed (e.g. a fill
            # event may only include EMSX_STATUS/EMSX_FILLED/EMSX_AVG_PRICE). Start
            # from whatever is already cached and only overwrite fields present on
            # THIS message — otherwise a delta-only update wipes out previously
            # known fields like ticker, which breaks downstream LME-ticker
            # filtering (see CLAUDE.md).
            with self._order_lock:
                is_new = seq not in self._order_cache
                entry = dict(self._order_cache.get(seq, {
                    "emsxSequence": seq,
                    "status": "",
                    "filledAmount": 0,
                    "avgPrice": 0.0,
                    "lots": 0,
                    "ticker": "",
                    "bs": "BUY",
                    "notes": "",
                    "createDate": 0,
                }))

            if msg.hasElement("EMSX_STATUS"):
                entry["status"] = msg.getElementAsString("EMSX_STATUS")
            if msg.hasElement("EMSX_FILLED"):
                entry["filledAmount"] = msg.getElementAsInteger("EMSX_FILLED")
            if msg.hasElement("EMSX_AMOUNT"):
                entry["lots"] = msg.getElementAsInteger("EMSX_AMOUNT")
            if msg.hasElement("EMSX_AVG_PRICE"):
                entry["avgPrice"] = msg.getElementAsFloat("EMSX_AVG_PRICE")
            if msg.hasElement("EMSX_TICKER"):
                entry["ticker"] = msg.getElementAsString("EMSX_TICKER")
            if msg.hasElement("EMSX_SIDE"):
                # Subscription messages send EMSX_SIDE as a string ("BUY"/"SELL"), not an integer
                side_raw = msg.getElementAsString("EMSX_SIDE")
                entry["bs"] = side_raw if side_raw in ("BUY", "SELL") else ("SELL" if side_raw in ("2", "S") else "BUY")
            if msg.hasElement("EMSX_NOTES"):
                entry["notes"] = msg.getElementAsString("EMSX_NOTES")
            if msg.hasElement("EMSX_DATE"):
                # EMSX_DATE is already a YYYYMMDD integer — no conversion needed.
                entry["createDate"] = msg.getElementAsInteger("EMSX_DATE")
            entry["emsxSequence"] = seq

            with self._order_lock:
                self._order_cache[seq] = entry
                cache_size = len(self._order_cache)
            if is_new:
                log.info(
                    "Cached EMSX order seq=%d status=%s notes=%r (cache size=%d)",
                    seq, entry["status"], entry["notes"], cache_size,
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

    def get_all_cached_orders(self) -> list[dict]:
        """Every order in the shared-blotter cache — lets a teammate pick up a
        monitoring session without re-importing."""
        with self._order_lock:
            return list(self._order_cache.values())

    def get_order_refs_with_matches(self) -> dict[str, list[dict]]:
        """Return {orderId: [{emsxSequence, status}, ...]} for every EMSX order whose
        EMSX_NOTES matches that orderId, newest (highest sequence) first.

        Unlike a "latest wins" lookup, this intentionally returns the FULL set of matches.
        An orderId can appear on more than one EMSX order (cancel + re-submit, or multiple
        re-submits), and collapsing to just the newest hides that history from the trader.
        Showing every match is a deliberate sanity check: the trader sees the whole chain
        (e.g. CANCELLED -> REJECTED -> WORKING) and decides whether it's safe to proceed,
        rather than the app deciding for them.
        """
        grouped: dict[str, list[dict]] = {}
        with self._order_lock:
            for o in self._order_cache.values():
                val = (o.get("notes") or "").strip()
                if not val:
                    continue
                grouped.setdefault(val, []).append(
                    {"emsxSequence": o.get("emsxSequence", 0), "status": o.get("status", "")}
                )
        for matches in grouped.values():
            matches.sort(key=lambda m: m["emsxSequence"], reverse=True)
        return grouped

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
                    "ticker": o.get("ticker"),
                    "bs": o.get("bs"),
                    "lots": o.get("lots"),
                    "avgPrice": o.get("avgPrice"),
                    "createDate": o.get("createDate"),
                }
                for o in self._order_cache.values()
            ]
        return {"count": len(orders), "orders": orders}


# Singleton instance — imported by main.py and emsx.py
bbg = BloombergManager()

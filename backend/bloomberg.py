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
from typing import Any

from config import BBG_HOST, BBG_PORT, EMSX_SERVICE, REF_SERVICE

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
        fields = "EMSX_SEQUENCE,EMSX_STATUS,EMSX_FILLED,EMSX_AMOUNT,EMSX_TICKER,EMSX_SIDE"
        # NOTE: The exact topic string format may need adjustment based on your
        # EMSX environment. This follows the standard Bloomberg EMSX Python sample.
        topic = f"{EMSX_SERVICE}/order;fields={fields}"
        subs.add(topic, correlationId=blpapi.CorrelationId("emsx_orders"))
        self._session.subscribe(subs)

    # ------------------------------------------------------------------
    # Background event loop
    # ------------------------------------------------------------------

    def _event_loop(self) -> None:
        while self._running:
            event = self._session.nextEvent(500)
            if event.eventType() == blpapi.Event.TIMEOUT:
                continue
            for msg in event:
                try:
                    self._dispatch(event.eventType(), msg)
                except Exception:
                    log.exception("Error dispatching Bloomberg event")

    def _dispatch(self, event_type: int, msg: blpapi.Message) -> None:
        msg_type = str(msg.messageType())

        # EMSX subscription updates — order/route fields from the exchange
        if msg_type in ("OrderRouteFields", "Order", "Route"):
            self._handle_emsx_update(msg)
            return

        # Request/response pair — wake up the waiting caller
        for cid in msg.correlationIds():
            val = cid.value()
            with self._pending_lock:
                q = self._pending.get(val)
            if q:
                q.put(msg)

    def _handle_emsx_update(self, msg: blpapi.Message) -> None:
        try:
            seq = msg.getElementAsInteger("EMSX_SEQUENCE")
            status = msg.getElementAsString("EMSX_STATUS") if msg.hasElement("EMSX_STATUS") else ""
            filled = msg.getElementAsInteger("EMSX_FILLED") if msg.hasElement("EMSX_FILLED") else 0
            amount = msg.getElementAsInteger("EMSX_AMOUNT") if msg.hasElement("EMSX_AMOUNT") else 0
            ticker = msg.getElementAsString("EMSX_TICKER") if msg.hasElement("EMSX_TICKER") else ""
            side_int = msg.getElementAsInteger("EMSX_SIDE") if msg.hasElement("EMSX_SIDE") else 1

            with self._order_lock:
                self._order_cache[seq] = {
                    "emsxSequence": seq,
                    "status": status,
                    "filledAmount": filled,
                    "lots": amount,
                    "ticker": ticker,
                    "bs": "BUY" if side_int == 1 else "SELL",
                }
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


# Singleton instance — imported by main.py and emsx.py
bbg = BloombergManager()

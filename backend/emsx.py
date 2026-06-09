"""
EMSX order operations via blpapi.

All calls are synchronous (block until Bloomberg responds or timeout).
FastAPI endpoints should run these in a thread executor to avoid blocking
the async event loop.
"""

import blpapi
import logging

from .bloomberg import bbg
from .config import (
    EMSX_ACCOUNT, EMSX_BROKER, EMSX_ORDER_TYPE,
    EMSX_TIF, EMSX_HAND_INSTR,
)

log = logging.getLogger(__name__)


def _side_int(bs: str) -> int:
    return 1 if bs.upper() == "BUY" else 2


def _try_set(req: blpapi.Request, field: str, value) -> None:
    """Set a field on the request; log a warning if the field is not supported."""
    try:
        req.set(field, value)
    except Exception:
        log.warning("EMSX field %r not supported on this service — skipped", field)


def submit_order(order: dict) -> dict:
    """
    Submit a single order to EMSX via CreateOrderAndRouteRequest.

    order keys expected: ticker, bs, lots, orderId
    Returns: {emsxSequence, status, orderId}
    """
    svc = bbg.emsx_service
    req = svc.createRequest("CreateOrderAndRoute")

    # Core required fields
    req.set("EMSX_TICKER",     order["ticker"])        # e.g. "LAH6 Comdty"
    req.set("EMSX_SIDE",       _side_int(order["bs"])) # 1=BUY, 2=SELL
    req.set("EMSX_AMOUNT",     int(order["lots"]))
    req.set("EMSX_ORDER_TYPE", EMSX_ORDER_TYPE)        # "MOC"
    req.set("EMSX_TIF",        EMSX_TIF)               # "DAY"
    req.set("EMSX_BROKER",     EMSX_BROKER)            # "KMTF"
    req.set("EMSX_ACCOUNT",    EMSX_ACCOUNT)           # from .env

    # Optional fields — set defensively in case the service schema differs
    _try_set(req, "EMSX_HAND_INSTRUCTION", EMSX_HAND_INSTR)  # "MAN"
    _try_set(req, "EMSX_NOTES",            order["orderId"])  # EATrade order ID

    log.info(
        "Submitting EMSX order: %s %s %d lots via %s",
        order["bs"], order["ticker"], order["lots"], EMSX_BROKER,
    )

    msg = bbg.send_request_sync(req, timeout=30)
    return _parse_submit_response(msg, order["orderId"])


def _parse_submit_response(msg: blpapi.Message, order_id: str) -> dict:
    msg_type = str(msg.messageType())
    log.info("EMSX response type: %s", msg_type)

    ERROR_TYPES = ("Error", "ErrorResponse", "Failure", "ErrorInfo")
    if msg_type in ERROR_TYPES:
        reason = _extract_error(msg)
        raise RuntimeError(f"EMSX rejected order {order_id} [{msg_type}]: {reason}")

    try:
        emsx_seq = msg.getElementAsInteger("EMSX_SEQUENCE")
    except Exception:
        try:
            emsx_seq = msg.getElement("EMSX_SEQUENCE").getValueAsInteger()
        except Exception:
            raise RuntimeError(
                f"Could not extract EMSX_SEQUENCE from response for order {order_id}. "
                f"Response type was: {msg_type}. Full message: {msg}"
            )

    status = msg.getElementAsString("EMSX_STATUS") if msg.hasElement("EMSX_STATUS") else ""
    log.info("Order %s → EMSX sequence %d status=%s", order_id, emsx_seq, status)
    return {"emsxSequence": emsx_seq, "status": status, "orderId": order_id}


def _extract_error(msg: blpapi.Message) -> str:
    # Bloomberg ErrorInfo messages use several possible field names for the reason
    for field in ("DESCRIPTION", "MESSAGE", "ERROR_MESSAGE", "REASON", "CATEGORY", "SUB_CATEGORY"):
        try:
            val = msg.getElementAsString(field)
            if val:
                return f"{field}={val}"
        except Exception:
            pass
    return str(msg)


def get_fill_status(sequences: list[int]) -> list[dict]:
    """
    Return cached fill state for the given EMSX sequence numbers.
    State is populated by the background EMSX order subscription in bloomberg.py.
    """
    cached = {r["emsxSequence"]: r for r in bbg.get_cached_orders(sequences)}

    results = []
    for seq in sequences:
        if seq in cached:
            results.append(cached[seq])
        else:
            results.append({
                "emsxSequence": seq,
                "status": "PENDING",
                "filledAmount": 0,
                "lots": 0,
                "ticker": "",
                "bs": "",
            })
    return results

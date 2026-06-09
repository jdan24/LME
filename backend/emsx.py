"""
EMSX order operations via blpapi.

All calls are synchronous (block until Bloomberg responds or timeout).
FastAPI endpoints should run these in a thread executor to avoid blocking
the async event loop.

EMSX field names (prefixed EMSX_) are the standard Bloomberg field identifiers.
If any field is rejected by EMSX, confirm the exact name with Bloomberg support
or check the EMSX API Field List documentation.
"""

import blpapi
import logging
from typing import Any

from .bloomberg import bbg
from .config import (
    EMSX_ACCOUNT, EMSX_BROKER, EMSX_ORDER_TYPE,
    EMSX_TIF, EMSX_HAND_INSTR,
)

log = logging.getLogger(__name__)


def _side_int(bs: str) -> int:
    return 1 if bs.upper() == "BUY" else 2


def submit_order(order: dict) -> dict:
    """
    Submit a single order to EMSX via CreateOrderAndRouteExtendedRequest.

    order keys expected: ticker, bs, lots, orderId

    Returns: {emsxSequence, status, orderId}
    """
    svc = bbg.emsx_service
    req = svc.createRequest("CreateOrderAndRouteExtendedRequest")

    req.set("EMSX_TICKER", order["ticker"])          # e.g. "LAH6 Comdty"
    req.set("EMSX_SIDE", _side_int(order["bs"]))     # 1=BUY, 2=SELL
    req.set("EMSX_AMOUNT", int(order["lots"]))
    req.set("EMSX_ORDER_TYPE", EMSX_ORDER_TYPE)       # "MOC"
    req.set("EMSX_TIF", EMSX_TIF)                    # "DAY"
    req.set("EMSX_BROKER", EMSX_BROKER)              # "KMTF"
    req.set("EMSX_ACCOUNT", EMSX_ACCOUNT)            # "367A0027"
    req.set("EMSX_HAND_INSTRUCTION", EMSX_HAND_INSTR)  # "MAN"
    req.set("EMSX_NOTES", order["orderId"])           # EATrade order ID for traceability

    log.info(
        "Submitting EMSX order: %s %s %d lots via %s",
        order["bs"], order["ticker"], order["lots"], EMSX_BROKER,
    )

    msg = bbg.send_request_sync(req, timeout=30)
    return _parse_submit_response(msg, order["orderId"])


def _parse_submit_response(msg: blpapi.Message, order_id: str) -> dict:
    msg_type = str(msg.messageType())

    # The response type may be "CreateOrderAndRouteExtendedResponse" or "E2E_ACK"
    # depending on the EMSX version and service endpoint.
    if msg_type in ("Error", "ErrorResponse", "Failure"):
        reason = _extract_error(msg)
        raise RuntimeError(f"EMSX rejected order {order_id}: {reason}")

    try:
        emsx_seq = msg.getElementAsInteger("EMSX_SEQUENCE")
    except Exception:
        # Some EMSX environments return the sequence under a different path
        try:
            emsx_seq = msg.getElement("EMSX_SEQUENCE").getValueAsInteger()
        except Exception:
            raise RuntimeError(f"Could not extract EMSX_SEQUENCE from response for order {order_id}")

    status = ""
    if msg.hasElement("EMSX_STATUS"):
        status = msg.getElementAsString("EMSX_STATUS")

    log.info("Order %s → EMSX sequence %d status=%s", order_id, emsx_seq, status)
    return {"emsxSequence": emsx_seq, "status": status, "orderId": order_id}


def _extract_error(msg: blpapi.Message) -> str:
    try:
        return msg.getElementAsString("MESSAGE")
    except Exception:
        return str(msg)


def get_fill_status(sequences: list[int]) -> list[dict]:
    """
    Return cached fill state for the given EMSX sequence numbers.

    State is populated by the background EMSX order subscription in bloomberg.py.
    If a sequence is not in cache yet (subscription update hasn't arrived),
    a placeholder entry with PENDING status is returned.
    """
    cached = {r["emsxSequence"]: r for r in bbg.get_cached_orders(sequences)}

    results = []
    for seq in sequences:
        if seq in cached:
            results.append(cached[seq])
        else:
            # Order was submitted but no subscription update received yet
            results.append({
                "emsxSequence": seq,
                "status": "PENDING",
                "filledAmount": 0,
                "lots": 0,
                "ticker": "",
                "bs": "",
            })
    return results

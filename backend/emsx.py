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


def _normalize_side(bs: str) -> str:
    """EMSX_SIDE is a STRING field: 'BUY' or 'SELL' (not an integer)."""
    return "SELL" if bs.upper() in ("SELL", "S", "2") else "BUY"


def _try_set(req: blpapi.Request, field: str, value) -> None:
    """Set a field on the request; log a warning if the field is not supported."""
    try:
        req.set(field, value)
    except Exception:
        log.warning("EMSX field %r not supported on this service — skipped", field)


def log_order_schema() -> None:
    """
    Log the CreateOrder request schema to the terminal at startup. Shows every
    field, its type, cardinality (min/max), and whether it is REQUIRED, so
    encode/validation failures can be diagnosed without hitting a debug endpoint.
    """
    try:
        svc = bbg.emsx_service
        op = svc.getOperation("CreateOrder")
        req_def = op.requestDefinition()
        lines: list[str] = []
        _describe_schema(req_def, lines, 0)
        log.info("CreateOrder request schema:\n%s", "\n".join(lines))
    except Exception:
        log.exception("Could not log CreateOrder schema")


def _describe_schema(elem_def, lines: list[str], depth: int) -> None:
    type_def = elem_def.typeDefinition()
    try:
        mn = elem_def.minValues()
        mx = elem_def.maxValues()
    except Exception:
        mn = mx = None
    flag = "REQUIRED" if (isinstance(mn, int) and mn >= 1) else "optional"
    indent = "    " * depth
    lines.append(f"{indent}{elem_def.name()}  <{type_def.name()}>  min={mn} max={mx}  {flag}")
    if depth < 5:
        try:
            for i in range(type_def.numElementDefinitions()):
                _describe_schema(type_def.getElementDefinition(i), lines, depth + 1)
        except Exception:
            pass


def _set_strategy(req: blpapi.Request, name: str) -> None:
    """
    Attach an EMSX strategy to the request.

    Strategy is a structured element (EMSX_STRATEGY_PARAMS), not a scalar field:
        EMSX_STRATEGY_PARAMS
        ├── EMSX_STRATEGY_NAME            (string)
        ├── EMSX_STRATEGY_FIELD_INDICATORS[]  (0 = use field data, 1 = ignore)
        └── EMSX_STRATEGY_FIELDS[]            (EMSX_FIELD_DATA per field)

    "NONE" is a no-algo strategy with zero fields, so we set only the name and
    leave both parallel arrays empty.
    """
    strat = req.getElement("EMSX_STRATEGY_PARAMS")
    strat.setElement("EMSX_STRATEGY_NAME", name)

    # The schema requires BOTH arrays to have min=1 once EMSX_STRATEGY_PARAMS is
    # present. For a no-field strategy ("NONE") we send a single placeholder
    # field flagged to be ignored: EMSX_FIELD_DATA = "" with
    # EMSX_FIELD_INDICATOR = 1 (1 = ignore this field, 0 = use its value).
    fields     = strat.getElement("EMSX_STRATEGY_FIELDS")
    indicators = strat.getElement("EMSX_STRATEGY_FIELD_INDICATORS")
    fields.appendElement().setElement("EMSX_FIELD_DATA", "")
    indicators.appendElement().setElement("EMSX_FIELD_INDICATOR", 1)


def submit_order(order: dict) -> dict:
    """
    Stage a single order into the EMSX blotter via CreateOrder.

    The order is created but NOT routed — the trader reviews and routes it
    manually inside EMSX. Because nothing is routed, the broker's strategy
    requirement does not apply here (strategy is a route-time concern), so no
    EMSX_STRATEGY_PARAMS is sent.

    order keys expected: ticker, bs, lots, orderId
    Returns: {emsxSequence, status, orderId}
    """
    svc = bbg.emsx_service
    # CreateOrder stages the order in the blotter without routing it to a broker.
    req = svc.createRequest("CreateOrder")

    # Core required fields
    req.set("EMSX_TICKER",     order["ticker"])             # e.g. "LAH6 Comdty"
    req.set("EMSX_SIDE",       _normalize_side(order["bs"])) # "BUY" / "SELL" (string)
    req.set("EMSX_AMOUNT",     int(order["lots"]))
    req.set("EMSX_ORDER_TYPE", EMSX_ORDER_TYPE)        # "MOC"
    req.set("EMSX_TIF",        EMSX_TIF)               # "DAY"

    # Optional fields — set defensively in case the CreateOrder schema differs.
    # Broker is the *intended* route destination, pre-filled for the trader; the
    # actual route (and strategy) is selected manually in EMSX.
    _try_set(req, "EMSX_BROKER",           EMSX_BROKER)      # "WFGB" / "KMTF"
    _try_set(req, "EMSX_ACCOUNT",          EMSX_ACCOUNT)     # from .env
    _try_set(req, "EMSX_HAND_INSTRUCTION", EMSX_HAND_INSTR)  # "MAN"
    # EATrade OrderId written to both: ORDER_REF_ID for reliable de-dup matching,
    # NOTES so the trader sees it on the blotter.
    _try_set(req, "EMSX_NOTES",         order["orderId"])
    _try_set(req, "EMSX_ORDER_REF_ID",  order["orderId"])

    log.info(
        "Staging EMSX order (no route): %s %s %d lots, intended broker %s",
        order["bs"], order["ticker"], order["lots"], EMSX_BROKER,
    )
    # Dump the fully-built request so encode failures can be diagnosed
    try:
        log.info("EMSX request structure:\n%s", req)
    except Exception:
        log.warning("Could not stringify EMSX request for logging")

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
                "avgPrice": 0.0,
                "lots": 0,
                "ticker": "",
                "bs": "",
            })
    return results

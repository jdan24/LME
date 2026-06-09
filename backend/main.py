"""
LME Order Entry — FastAPI backend.

Runs on localhost:8000. The React frontend (Vite dev server on :5173)
proxies /api/* requests here.

All Bloomberg calls are executed in a thread pool executor because blpapi
is synchronous and must not block the asyncio event loop.
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .bloomberg import bbg
from .emsx import submit_order, get_fill_status, log_order_schema
from .refdata import get_settlement
from .config import EMSX_ACCOUNT, EMSX_BROKER, EMSX_ORDER_TYPE, EMSX_TIF, EMSX_HAND_INSTR, EMSX_SERVICE

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

executor = ThreadPoolExecutor(max_workers=4)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Starting Bloomberg session…")
    try:
        bbg.start()
        log.info("Bloomberg session ready")
        log_order_schema()
    except Exception as exc:
        log.error("Bloomberg session failed to start: %s", exc)
        # Server starts anyway so health endpoint can report the failure
    yield
    bbg.stop()


app = FastAPI(title="LME Order Entry", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    # "null" is the Origin sent by browsers when opening a file:// page.
    # localhost origins are kept for `npm run dev` during development.
    allow_origins=["null", "http://localhost:5173", "http://localhost:4173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class OrderIn(BaseModel):
    contract: str
    ticker: str
    bs: str
    lots: int
    orderId: str
    mkt: str


class SubmitRequest(BaseModel):
    orders: list[OrderIn]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok", "bloomberg": "connected" if bbg.connected else "disconnected"}


@app.get("/api/config")
async def get_config():
    """Returns display-only order config for the frontend. Values come from .env."""
    return {
        "account": EMSX_ACCOUNT,
        "broker": EMSX_BROKER,
        "orderType": EMSX_ORDER_TYPE,
        "tif": EMSX_TIF,
        "handlingInstr": EMSX_HAND_INSTR,
    }


@app.post("/api/submit-orders")
async def submit_orders_endpoint(body: SubmitRequest):
    if not bbg.connected:
        raise HTTPException(503, "Bloomberg session not available")
    if not body.orders:
        raise HTTPException(400, "No orders provided")

    loop = asyncio.get_event_loop()
    results = []
    errors = []

    for order in body.orders:
        try:
            result = await loop.run_in_executor(
                executor, submit_order, order.model_dump()
            )
            results.append(result)
        except Exception as exc:
            log.error("Failed to submit order %s: %s", order.orderId, exc)
            errors.append({"orderId": order.orderId, "error": str(exc)})

    if errors and not results:
        raise HTTPException(500, {"message": "All orders failed", "errors": errors})

    return {"results": results, "errors": errors}


@app.get("/api/fill-status")
async def fill_status_endpoint(ids: str = Query(..., description="Comma-separated EMSX sequence numbers")):
    if not bbg.connected:
        raise HTTPException(503, "Bloomberg session not available")

    try:
        sequences = [int(x.strip()) for x in ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(400, "ids must be comma-separated integers")

    loop = asyncio.get_event_loop()
    fills = await loop.run_in_executor(executor, get_fill_status, sequences)
    return {"fills": fills}


@app.get("/api/debug/emsx-schema")
async def emsx_schema():
    """
    Probe the connected EMSX service for available operations.
    Returns schema introspection results AND a trial list of known candidate names.
    """
    if not bbg.connected:
        raise HTTPException(503, "Bloomberg session not available")

    svc = bbg.emsx_service

    # Try schema introspection via blpapi
    schema_ops: list[str] = []
    schema_error: str | None = None
    try:
        n = svc.numOperations()
        for i in range(n):
            op = svc.getOperation(i)
            schema_ops.append(str(op.name()))
    except Exception as exc:
        schema_error = str(exc)

    # Probe known candidate names — createRequest() doesn't throw; sending does.
    # Instead, check if the operation exists in the service schema by name lookup.
    candidates = [
        "CreateOrder",
        "RouteOrder",
        "CreateOrderAndRoute",
        "CreateOrderAndRouteEx",
        "CreateOrderAndRouteExtended",
        "CreateOrderAndRouteRequest",
        "CreateOrderAndRouteExtendedRequest",
        "CreateOrderAndRouteManually",
    ]
    probe_results: dict[str, str] = {}
    for name in candidates:
        try:
            svc.getOperation(name)
            probe_results[name] = "FOUND"
        except Exception as exc:
            probe_results[name] = f"NOT FOUND: {exc}"

    # Dump the full request definition tree for the order operation(s) so we can
    # see every field, its type, and whether it is required (min >= 1).
    request_schemas: dict[str, object] = {}
    for op_name in ("CreateOrderAndRouteEx", "CreateOrderAndRoute"):
        try:
            op = svc.getOperation(op_name)
            req_def = op.requestDefinition()
            request_schemas[op_name] = _dump_element_def(req_def)
        except Exception as exc:
            request_schemas[op_name] = f"ERROR: {exc}"

    return {
        "service": EMSX_SERVICE,
        "schema_operations": sorted(schema_ops),
        "schema_error": schema_error,
        "candidate_probe": probe_results,
        "request_schemas": request_schemas,
    }


def _dump_element_def(elem_def, depth: int = 0, max_depth: int = 6) -> dict:
    """Recursively describe a blpapi SchemaElementDefinition: name, type, cardinality, children."""
    type_def = elem_def.typeDefinition()
    try:
        min_v = elem_def.minValues()
        max_v = elem_def.maxValues()
    except Exception:
        min_v, max_v = None, None

    node: dict = {
        "name": str(elem_def.name()),
        "type": str(type_def.name()),
        "min": min_v,
        "max": max_v,
        "required": (min_v is not None and min_v >= 1),
    }

    if depth < max_depth:
        try:
            num = type_def.numElementDefinitions()
            if num > 0:
                node["children"] = [
                    _dump_element_def(type_def.getElementDefinition(i), depth + 1, max_depth)
                    for i in range(num)
                ]
        except Exception:
            pass

    return node


@app.get("/api/settlement")
async def settlement_endpoint(tickers: str = Query(..., description="Comma-separated Bloomberg tickers")):
    if not bbg.connected:
        raise HTTPException(503, "Bloomberg session not available")

    ticker_list = [t.strip() for t in tickers.split(",") if t.strip()]
    if not ticker_list:
        raise HTTPException(400, "No tickers provided")

    loop = asyncio.get_event_loop()
    settlements = await loop.run_in_executor(executor, get_settlement, ticker_list)
    return {"settlements": settlements}

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

from bloomberg import bbg
from emsx import submit_order, get_fill_status
from refdata import get_settlement
from config import EMSX_ACCOUNT, EMSX_BROKER, EMSX_ORDER_TYPE, EMSX_TIF, EMSX_HAND_INSTR

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

executor = ThreadPoolExecutor(max_workers=4)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Starting Bloomberg session…")
    try:
        bbg.start()
        log.info("Bloomberg session ready")
    except Exception as exc:
        log.error("Bloomberg session failed to start: %s", exc)
        # Server starts anyway so health endpoint can report the failure
    yield
    bbg.stop()


app = FastAPI(title="LME Order Entry", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
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

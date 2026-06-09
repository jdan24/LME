"""
Bloomberg reference data — settlement price fetching.

Fetches PX_SETTLE_ACTUAL_RT and PX_SETTLE_LAST_DT_RT for a list of tickers
and determines settlement freshness relative to today's date.
"""

import blpapi
import logging
from datetime import date, timedelta

from .bloomberg import bbg
from .config import SETTLE_PRICE_FIELD, SETTLE_DATE_FIELD

log = logging.getLogger(__name__)


def _prev_business_day(d: date) -> date:
    """Return the previous business day (Mon–Fri only, no holiday calendar)."""
    day = d - timedelta(days=1)
    while day.weekday() >= 5:  # 5=Sat, 6=Sun
        day -= timedelta(days=1)
    return day


def _freshness(settle_date: date | None) -> str:
    if settle_date is None:
        return "unavailable"
    today = date.today()
    if settle_date == today:
        return "today"
    if settle_date == _prev_business_day(today):
        return "prior"
    return "stale"


def get_settlement(tickers: list[str]) -> list[dict]:
    """
    Fetch settlement price and date for each ticker.

    Returns a list of dicts with keys:
        ticker, contract, price, settleDate, freshness
    """
    svc = bbg.refdata_service
    req = svc.createRequest("ReferenceDataRequest")

    sec_elem = req.getElement("securities")
    for t in tickers:
        sec_elem.appendValue(t)

    fld_elem = req.getElement("fields")
    fld_elem.appendValue(SETTLE_PRICE_FIELD)
    fld_elem.appendValue(SETTLE_DATE_FIELD)

    log.info("Requesting settlement for: %s", tickers)
    msg = bbg.send_request_sync(req, timeout=15)
    return _parse_ref_response(msg, tickers)


def _parse_ref_response(msg: blpapi.Message, tickers: list[str]) -> list[dict]:
    results = []

    if not msg.hasElement("securityData"):
        log.warning("No securityData in reference data response")
        return [_empty_settlement(t) for t in tickers]

    sec_data = msg.getElement("securityData")

    for i in range(sec_data.numValues()):
        row = sec_data.getValue(i)
        ticker = row.getElementAsString("security")
        contract = ticker.replace(" Comdty", "")

        if row.hasElement("securityError"):
            log.warning("Security error for %s", ticker)
            results.append(_empty_settlement(ticker))
            continue

        fld_data = row.getElement("fieldData")

        price: float | None = None
        settle_date: date | None = None

        if fld_data.hasElement(SETTLE_PRICE_FIELD):
            try:
                price = fld_data.getElementAsFloat(SETTLE_PRICE_FIELD)
            except Exception:
                pass

        if fld_data.hasElement(SETTLE_DATE_FIELD):
            try:
                raw = fld_data.getElementAsString(SETTLE_DATE_FIELD)
                # Bloomberg date strings are typically "YYYY-MM-DD" or "MM/DD/YYYY"
                settle_date = _parse_bbg_date(raw)
            except Exception:
                log.exception("Failed to parse settle date for %s", ticker)

        results.append({
            "ticker": ticker,
            "contract": contract,
            "price": price,
            "settleDate": settle_date.isoformat() if settle_date else None,
            "freshness": _freshness(settle_date),
        })

    return results


def _empty_settlement(ticker: str) -> dict:
    return {
        "ticker": ticker,
        "contract": ticker.replace(" Comdty", ""),
        "price": None,
        "settleDate": None,
        "freshness": "unavailable",
    }


def _parse_bbg_date(raw: str) -> date | None:
    """Try common Bloomberg date formats."""
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y%m%d"):
        try:
            from datetime import datetime
            return datetime.strptime(raw.strip(), fmt).date()
        except ValueError:
            continue
    return None

import os
from pathlib import Path
from dotenv import load_dotenv

# LME_ENV picks which env file to load — set by start-prod.bat / start-uat.bat
# before launching uvicorn. Defaults to UAT so running the backend directly
# (e.g. `uvicorn backend.main:app` with no start script) never lands on the
# live service by accident.
LME_ENV = os.getenv("LME_ENV", "UAT").upper()
if LME_ENV not in ("PROD", "UAT"):
    raise RuntimeError(f"LME_ENV must be PROD or UAT, got {LME_ENV!r}")

# Project root is one level above backend/
load_dotenv(Path(__file__).parent.parent / f".env.{LME_ENV.lower()}")

# Bloomberg Desktop API connection — requires Bloomberg Terminal running
BBG_HOST = os.getenv("BBG_HOST", "localhost")
BBG_PORT = int(os.getenv("BBG_PORT", "8194"))

# Bloomberg services
# .env.prod sets EMSX_SERVICE=//blp/emapisvc (live); .env.uat sets
# //blp/emapisvc_beta (default, used if a file omits it).
EMSX_SERVICE = os.getenv("EMSX_SERVICE", "//blp/emapisvc_beta")

# Bloomberg EMSX team name for team-level order subscription — determines which
# team's full blotter is visible via the API. Derived from EMSX_SERVICE so
# switching service automatically switches team with no separate config needed.
EMSX_TEAM = "WFC_FUTURES" if EMSX_SERVICE == "//blp/emapisvc" else "FCMTEST"
REF_SERVICE = "//blp/refdata"

# Required — must be set in .env.prod / .env.uat (no defaults so misconfiguration fails loudly)
EMSX_ACCOUNT = os.environ["EMSX_ACCOUNT"]
EMSX_BROKER  = os.environ["EMSX_BROKER"]

# Fixed EMSX order parameters (not configurable per-order)
EMSX_ORDER_TYPE = "MOC"   # Market On Close
EMSX_TIF        = "DAY"
EMSX_HAND_INSTR = "MAN"

# Bloomberg settlement fields
SETTLE_PRICE_FIELD = "PX_SETTLE_ACTUAL_RT"
SETTLE_DATE_FIELD  = "PX_SETTLE_LAST_DT_RT"

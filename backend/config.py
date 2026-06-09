import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from the project root (one level above backend/)
load_dotenv(Path(__file__).parent.parent / ".env")

# Bloomberg Desktop API connection — requires Bloomberg Terminal running
BBG_HOST = os.getenv("BBG_HOST", "localhost")
BBG_PORT = int(os.getenv("BBG_PORT", "8194"))

# Bloomberg services
# Set EMSX_SERVICE=//blp/emapisvc in .env to switch from UAT to live
EMSX_SERVICE = os.getenv("EMSX_SERVICE", "//blp/emapisvc_beta")
REF_SERVICE = "//blp/refdata"

# Required — must be set in .env (no defaults so misconfiguration fails loudly)
EMSX_ACCOUNT = os.environ["EMSX_ACCOUNT"]
EMSX_BROKER  = os.environ["EMSX_BROKER"]

# Fixed EMSX order parameters (not configurable per-order)
EMSX_ORDER_TYPE = "MOC"   # Market On Close
EMSX_TIF        = "DAY"
EMSX_HAND_INSTR = "MAN"

# Bloomberg settlement fields
SETTLE_PRICE_FIELD = "PX_SETTLE_ACTUAL_RT"
SETTLE_DATE_FIELD  = "PX_SETTLE_LAST_DT_RT"

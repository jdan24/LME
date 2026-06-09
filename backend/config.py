# Bloomberg Desktop API connection (requires Bloomberg Terminal running)
BBG_HOST = "localhost"
BBG_PORT = 8194

# Bloomberg services
# Switch EMSX_SERVICE to "//blp/emapisvc" for live orders (emapisvc_beta = UAT)
EMSX_SERVICE = "//blp/emapisvc_beta"
REF_SERVICE = "//blp/refdata"

# Fixed EMSX order parameters — all LME orders use these values
EMSX_ACCOUNT = "367A0027"
EMSX_BROKER = "KMTF"
EMSX_ORDER_TYPE = "MOC"   # Market On Close
EMSX_TIF = "DAY"
EMSX_HAND_INSTR = "MAN"

# Bloomberg settlement fields
SETTLE_PRICE_FIELD = "PX_SETTLE_ACTUAL_RT"
SETTLE_DATE_FIELD = "PX_SETTLE_LAST_DT_RT"

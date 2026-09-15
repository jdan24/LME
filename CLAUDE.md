# LME Order Entry Tool — Claude Guidelines

## Project Overview

Full-stack Bloomberg order entry application for LME (London Metal Exchange) traders. The frontend bundles into a single `index.html` at the project root; the backend is a FastAPI server that connects to Bloomberg Terminal via EMSX and RefData APIs.

## Tech Stack

**Frontend:** React 19, TypeScript, Vite, Tailwind CSS, `vite-plugin-singlefile`
**Backend:** Python, FastAPI, Uvicorn, `blpapi` (Bloomberg Desktop API)
**Platform:** Windows (Bloomberg Terminal required on localhost:8194)

## Project Structure

```
LME/
├── CLAUDE.md                        # This file
├── index.html                       # Built frontend output (single-file bundle)
├── start-prod.bat                    # Launch script: starts backend in PROD, opens frontend
├── start-uat.bat                     # Launch script: starts backend in UAT, opens frontend
├── .env.prod.example                 # PROD Bloomberg config template
├── .env.uat.example                  # UAT Bloomberg config template
├── backend/
│   ├── launch.py                    # Start-script entry point: picks a free port, opens browser
│   ├── main.py                      # FastAPI app (port 8000 by default), serves index.html at /
│   ├── bloomberg.py                 # Bloomberg session manager + subscriptions
│   ├── emsx.py                      # EMSX order submission and fill tracking
│   ├── refdata.py                   # Reference data (settlement prices)
│   ├── config.py                    # Environment variable loading
│   └── requirements.txt             # Python dependencies
└── frontend/
    ├── src/
    │   ├── App.tsx                  # Main app component
    │   ├── types.ts                 # TypeScript interfaces
    │   ├── api/client.ts            # Backend API client
    │   ├── components/
    │   │   ├── FillStatus.tsx       # Order fill status display
    │   │   ├── OrderSummary.tsx     # Summary statistics
    │   │   ├── OrderTable.tsx       # Main order list table
    │   │   ├── PasteArea.tsx        # Data paste/import area
    │   │   ├── SettlementPanel.tsx  # Settlement data panel
    │   │   ├── SubmitControls.tsx   # Submit button and controls
    │   │   └── TradeRecap.tsx       # Trade recap display
    │   └── utils/
    │       ├── lmeConfig.ts         # LME ticker validation
    │       └── parseClipboard.ts    # Clipboard parsing logic
    ├── vite.config.ts               # Builds single-file bundle to root index.html
    ├── package.json
    └── tsconfig.json
```

## Key Architectural Notes

- The frontend is built as a **single self-contained HTML file** (CSS and JS inlined) via `vite-plugin-singlefile`. The output is the root-level `index.html`, not `frontend/dist/`.
- **Port conflicts:** the bridge port is *not* fixed at 8000. Another app on the PROD machine held 8000 and uvicorn died with `WinError 10048`. The start scripts run `python -m backend.launch` (`backend/launch.py`), which checks ports from `APP_PORT` (default 8000) up to +10 *before* importing `backend.main`, so no Bloomberg session opens on an unusable port. A busy port answering `/api/health` with `app == "lme-order-entry"` and the same `environment` means the bridge is already running: open it and exit. Anything else: try the next port. `main.py` serves `index.html` at `/`, and `api/client.ts` uses same-origin `/api` when served over http (falling back to `localhost:8000` only for `file://`), so the page follows whatever port was chosen. `PasteArea.tsx` shows a red "Can't reach the LME Bloomberg bridge" banner after 4 failed health polls. Don't hardcode 8000 back into the start scripts or the client.
- CORS is configured to allow `file://` origins so the built `index.html` can be opened directly in a browser without a web server.
- Bloomberg calls are wrapped in a `ThreadPoolExecutor` to avoid blocking the async FastAPI event loop.
- Order deduplication uses a multi-attempt retry pattern (2.5s, 4s, 6s delays) to account for Bloomberg subscription lag.
- Duplicate detection matches on `EMSX_NOTES` (carries the full EATrade `orderId`), not `EMSX_ORDER_REF_ID` (truncated by the blotter and not a valid subscription field). `BloombergManager.get_order_refs_with_matches()` (`backend/bloomberg.py`) intentionally returns **every** EMSX order tied to an orderId (newest first by `EMSX_SEQUENCE`), not just the latest — this is a deliberate sanity check so a trader can see a full cancel/re-submit history (e.g. `CANCELLED` → `REJECTED` → `WORKING`) and decide whether it's safe to resubmit, rather than the app silently picking one status. The `/api/check-duplicates` response field is `matches: Record<orderId, Array<{emsxSequence, status}>>`. The frontend (`App.tsx`'s `runDupCheck`, `OrderTable.tsx`) renders all matches stacked (`#seq STATUS`) and unions them across retry attempts rather than overwriting, so a match seen on an earlier retry is never dropped. Do not collapse this back to a single "best" status — that was the prior (intentionally reverted) behavior.
- `BloombergManager._handle_emsx_update()` (`backend/bloomberg.py`) **merges** each EMSX order-subscription message into the existing cache entry (`dict(self._order_cache.get(seq, defaults))`, then overwrite only fields present via `msg.hasElement(...)`) rather than replacing the entry wholesale. Bloomberg sends a full "paint" on initial subscribe but later delta messages (e.g. a fill event) often carry only the fields that changed — just `EMSX_STATUS`/`EMSX_FILLED`/`EMSX_AVG_PRICE`, omitting `EMSX_TICKER`/`EMSX_SIDE`/`EMSX_NOTES`/`EMSX_DATE`. A wholesale overwrite blanks those omitted fields out (ticker → `""`), which silently breaks `isLmeTicker()` filtering downstream and made already-filled orders disappear from "Monitor orders already in EMSX" even though the backend cache showed the correct fill status. Do not revert this to a fresh-dict-per-message pattern.
- Blotter pulls (`App.tsx`'s `handleMonitorBlotter`, `handleRefreshOrders`, and `handleSubmit`'s post-submit team-order merge) load every EMSX status (active, filled, cancelled, rejected) — they only filter on LME ticker and today's date, never on status. The **Fill Status** screen (`FillStatus.tsx`) is where status filtering happens: it has an Active/Filled/All toggle (`FillStatusFilter` in `types.ts`, default `ACTIVE`) that controls which rows are *displayed*, always visible there regardless of whether the session started via Submit or via "Monitor orders already in EMSX". This is purely a display filter — `allFilled`/the settlement transition and `TradeRecap` always consider every order, not just the currently selected tab, so switching tabs never changes whether the session is "done."
- **Trade Recap** (`TradeRecap.tsx`) is sent by the desk *before* EMSX fills come back, because fills are marked to settlement. It lists every live order (not in `DEAD_STATUSES`, `frontend/src/utils/orderStatus.ts`; no status yet counts as live) at its **ordered lots**. Each row is priced at the Bloomberg settlement for its ticker, and Settle Date is the date Bloomberg returned. Both come from `/api/settlement`, fetched inside TradeRecap on mount, whenever the ticker set changes, and via its Refresh Settlement button. Columns: Side, Bloomberg Ticker, Qty, Price, Settle Date, Trader. It shows on every Fill Status tab and doesn't depend on fills. The Settle Date cell is tinted amber (prior day) or red (stale/unavailable), on screen only. `traderNames` stays in `FillStatus.tsx`. The separate `SettlementPanel` after "All Filled" is intentionally kept.
- **PROD vs UAT** is selected by the `LME_ENV` environment variable (`PROD` or `UAT`, defaults to `UAT`), set by `start-prod.bat` / `start-uat.bat` before launching uvicorn. `backend/config.py` reads `LME_ENV` and loads `.env.prod` or `.env.uat` accordingly (each gitignored, copied from the matching `.env.*.example`). `EMSX_SERVICE` in that file determines the actual Bloomberg endpoint (`//blp/emapisvc` live vs `//blp/emapisvc_beta` UAT) and the derived `EMSX_TEAM`; `LME_ENV` itself (not a re-derivation from `EMSX_SERVICE`) is what `/api/config` returns as `environment`, which `App.tsx` renders via `EnvironmentBanner` (`frontend/src/components/EnvironmentBanner.tsx`) — a badge fixed above all app states so it's visible regardless of which screen is showing. Running the backend directly without a start script (e.g. plain `uvicorn backend.main:app`) defaults to UAT rather than failing closed to PROD.

## Development Workflow

**Frontend dev server:**
```bash
cd frontend && npm run dev       # hot-reload dev server on :5173
```

**Backend (defaults to UAT if LME_ENV is unset):**
```bash
python -m backend.launch                        # auto port selection, same as start scripts
python -m uvicorn backend.main:app --port 8000  # or directly
```

**Or use `start-prod.bat` / `start-uat.bat` on Windows to launch both in the corresponding environment.**

## Build & Deploy Instructions

After completing any code changes:

1. **Build the frontend:**
   ```bash
   cd frontend && npm run build
   ```
   This runs TypeScript type-checking then Vite build, outputting a single `index.html` to the project root.

2. **Verify the build** — open the root `index.html` locally and confirm the change works as expected.

3. **Commit and push to GitHub:**
   ```bash
   git add -A
   git commit -m "<concise description of change>"
   git push
   ```

Always include the built `index.html` in the commit so the repo stays deployable.

## Collaboration Rules

**Always ask clarifying questions before starting work.** Before writing any code, confirm:
- The exact behavior or outcome expected
- Which part of the stack is affected (frontend, backend, or both)
- Any Bloomberg-specific constraints (UAT vs live service, specific LME tickers, etc.)
- Whether the change affects the build output or only development files

Do not assume intent — LME trading logic and Bloomberg API behavior have real financial consequences. When in doubt, ask.

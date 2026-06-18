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
├── start.bat                        # Launch script: starts backend, opens frontend
├── .env.example                     # Bloomberg config template
├── backend/
│   ├── main.py                      # FastAPI app entry point (port 8000)
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
- CORS is configured to allow `file://` origins so the built `index.html` can be opened directly in a browser without a web server.
- Bloomberg calls are wrapped in a `ThreadPoolExecutor` to avoid blocking the async FastAPI event loop.
- Order deduplication uses a multi-attempt retry pattern (2.5s, 4s, 6s delays) to account for Bloomberg subscription lag.
- Duplicate detection matches on `EMSX_NOTES` (carries the full EATrade `orderId`), not `EMSX_ORDER_REF_ID` (truncated by the blotter and not a valid subscription field). `BloombergManager.get_order_refs_with_matches()` (`backend/bloomberg.py`) intentionally returns **every** EMSX order tied to an orderId (newest first by `EMSX_SEQUENCE`), not just the latest — this is a deliberate sanity check so a trader can see a full cancel/re-submit history (e.g. `CANCELLED` → `REJECTED` → `WORKING`) and decide whether it's safe to resubmit, rather than the app silently picking one status. The `/api/check-duplicates` response field is `matches: Record<orderId, Array<{emsxSequence, status}>>`. The frontend (`App.tsx`'s `runDupCheck`, `OrderTable.tsx`) renders all matches stacked (`#seq STATUS`) and unions them across retry attempts rather than overwriting, so a match seen on an earlier retry is never dropped. Do not collapse this back to a single "best" status — that was the prior (intentionally reverted) behavior.
- `BloombergManager._handle_emsx_update()` (`backend/bloomberg.py`) **merges** each EMSX order-subscription message into the existing cache entry (`dict(self._order_cache.get(seq, defaults))`, then overwrite only fields present via `msg.hasElement(...)`) rather than replacing the entry wholesale. Bloomberg sends a full "paint" on initial subscribe but later delta messages (e.g. a fill event) often carry only the fields that changed — just `EMSX_STATUS`/`EMSX_FILLED`/`EMSX_AVG_PRICE`, omitting `EMSX_TICKER`/`EMSX_SIDE`/`EMSX_NOTES`/`EMSX_DATE`. A wholesale overwrite blanks those omitted fields out (ticker → `""`), which silently breaks `isLmeTicker()` filtering downstream and made already-filled orders disappear from "Monitor orders already in EMSX" even though the backend cache showed the correct fill status. Do not revert this to a fresh-dict-per-message pattern.
- Blotter pulls (`App.tsx`'s `handleMonitorBlotter`, `handleRefreshOrders`, and `handleSubmit`'s post-submit team-order merge) load every EMSX status (active, filled, cancelled, rejected) — they only filter on LME ticker and today's date, never on status. The **Fill Status** screen (`FillStatus.tsx`) is where status filtering happens: it has an Active/Filled/All toggle (`FillStatusFilter` in `types.ts`, default `ACTIVE`) that controls which rows are *displayed*, always visible there regardless of whether the session started via Submit or via "Monitor orders already in EMSX". This is purely a display filter — `allFilled`/the settlement transition and `TradeRecap` always consider every order, not just the currently selected tab, so switching tabs never changes whether the session is "done."

## Development Workflow

**Frontend dev server:**
```bash
cd frontend && npm run dev       # hot-reload dev server on :5173
```

**Backend:**
```bash
python -m uvicorn backend.main:app --port 8000
```

**Or use `start.bat` on Windows to launch both.**

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

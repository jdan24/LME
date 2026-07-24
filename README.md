# LME Order Entry Tool

A full-stack Bloomberg order-entry application for **LME (London Metal Exchange)** traders. It imports LME orders from EATrade, **stages** them into Bloomberg EMSX, and tracks fills through to settlement — all from a single screen.

> **Traders:** for a non-technical, step-by-step walkthrough see **[docs/LME-Order-Entry-User-Guide.pdf](docs/LME-Order-Entry-User-Guide.pdf)**. This README is for developers and IT.

---

## How it works

```
EATrade grid ──paste──▶  Frontend (single-file index.html)
                              │  HTTP (localhost:8000)
                              ▼
                         FastAPI backend  ──blpapi──▶  Bloomberg Terminal
                         "Bloomberg bridge"            (EMSX + RefData, :8194)
```

- The **frontend** is a React/TypeScript app bundled into one self-contained `index.html` (CSS + JS inlined) via `vite-plugin-singlefile`. It can be opened directly from disk (`file://`) — no web server needed.
- The **backend** ("the Bloomberg bridge") is a FastAPI app that talks to a locally running Bloomberg Terminal through the Bloomberg Desktop API (`blpapi`). It exposes a small JSON API on `localhost:8000`.
- Orders are **staged, not routed** — the tool places orders into EMSX; the trader routes them to market manually in EMSX. Fixed order parameters: **MOC** (Market-On-Close), **DAY**, handling **MAN**.

---

## Key features

- **Paste-to-stage import** — paste the EATrade clipboard grid; only rows where `MKT = LME_NTP` are parsed. Every row starts **unselected** so the trader deliberately chooses what to stage.
- **Duplicate detection against EMSX** — imported orders are checked against the live EMSX blotter by `orderId` (carried in `EMSX_NOTES`). Matches are flagged `⚠ IN EMSX` and show the **full** cancel/re-submit history (`#seq STATUS`, newest first) so the trader can judge whether a resubmit is safe. Checks retry on a delay (2.5s / 4s / 6s) to absorb blotter subscription lag, and results are unioned across attempts. **Select New** stages only orders not already in EMSX.
- **Fill tracking** — a Fill Status screen shows ordered vs. filled per order with an **Active / Filled / All** display toggle. Refreshing also picks up new LME orders that appeared in the shared blotter (e.g. a teammate's).
- **Monitor-only mode** — skip importing and pull today's LME orders already staged in the shared EMSX blotter to track fills.
- **Settlement prices** — once every order is filled, pull LME settlement prices for the traded contracts.
- **Environment banner** — a persistent badge shows the active environment (PROD/UAT) so it is always visible.

---

## Tech stack

| Layer | Technologies |
|-------|-------------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, `vite-plugin-singlefile` |
| Backend | Python, FastAPI, Uvicorn, `blpapi` (Bloomberg Desktop API) |
| Platform | Windows, with Bloomberg Terminal running on `localhost:8194` |

---

## Repository layout

```
LME/
├── index.html                  # Built frontend (single-file bundle) — committed, deployable
├── start-prod.bat              # Launch backend in PROD + open frontend
├── start-uat.bat               # Launch backend in UAT + open frontend
├── .env.prod.example           # PROD config template (copy to .env.prod)
├── .env.uat.example            # UAT config template (copy to .env.uat)
├── docs/
│   └── LME-Order-Entry-User-Guide.pdf   # Trader-facing guide (PROD)
├── backend/
│   ├── main.py                 # FastAPI app + API routes (port 8000)
│   ├── bloomberg.py            # Bloomberg session manager + EMSX subscriptions
│   ├── emsx.py                 # Order submission (staging) and fill tracking
│   ├── refdata.py              # Reference data (settlement prices)
│   ├── config.py               # Environment loading (LME_ENV → .env.prod/.env.uat)
│   └── requirements.txt
└── frontend/
    ├── src/                    # React app source
    ├── vite.config.ts          # Builds the single-file bundle to ../index.html
    └── package.json
```

---

## Configuration

The environment is selected by the **`LME_ENV`** variable (`PROD` or `UAT`, default `UAT`), which `backend/config.py` uses to load `.env.prod` or `.env.uat` from the project root. The start scripts set it for you.

Create the env file for your target (both are gitignored — never commit them):

```bash
# PROD
copy .env.prod.example .env.prod
# UAT
copy .env.uat.example .env.uat
```

Then fill in the values:

| Variable | Description |
|----------|-------------|
| `EMSX_ACCOUNT` | Bloomberg EMSX account number |
| `EMSX_BROKER` | Bloomberg EMSX broker code |
| `EMSX_SERVICE` | `//blp/emapisvc` (live) or `//blp/emapisvc_beta` (UAT) — determines the endpoint and the derived EMSX team |
| `BBG_HOST` / `BBG_PORT` | Bloomberg Desktop API connection (defaults `localhost:8194`) |

> Running the backend directly without a start script defaults to **UAT**, so it never lands on the live service by accident.

---

## Running

**Prerequisite:** Bloomberg Terminal must be running and logged in on the same machine.

### Windows (normal use)

```bat
start-prod.bat   :: PROD — starts the bridge (uvicorn :8000) and opens index.html
start-uat.bat    :: UAT
```

### Manual / development

Backend (defaults to UAT if `LME_ENV` is unset):

```bash
python -m uvicorn backend.main:app --port 8000
```

Frontend hot-reload dev server on `:5173`:

```bash
cd frontend && npm install
npm run dev
```

---

## Building & deploying

The committed root `index.html` **is** the deployable frontend, so it must be rebuilt and committed with any frontend change:

```bash
cd frontend && npm run build   # tsc type-check + Vite build → ../index.html
```

Then verify by opening the root `index.html` locally, and commit the rebuilt bundle:

```bash
git add -A
git commit -m "<concise description>"
git push
```

---

## API surface (backend, `localhost:8000`)

| Method | Route | Purpose |
|--------|-------|---------|
| `GET`  | `/api/health` | Bloomberg connection / EMSX readiness |
| `GET`  | `/api/config` | Active environment + fixed order params |
| `POST` | `/api/check-duplicates` | Match `orderId`s against the EMSX blotter |
| `GET`  | `/api/blotter-orders` | All LME orders in the shared blotter |
| `POST` | `/api/submit-orders` | Stage selected orders into EMSX |
| `GET`  | `/api/fill-status` | Fill amounts/status by EMSX sequence |
| `GET`  | `/api/settlement` | LME settlement prices by ticker |

---

## Notes for maintainers

- **CORS** allows `file://` origins so the built `index.html` runs straight from disk.
- Bloomberg calls run in a `ThreadPoolExecutor` to keep the async event loop unblocked.
- Duplicate detection matches on `EMSX_NOTES` (full `orderId`), **not** the truncated `EMSX_ORDER_REF_ID`, and intentionally returns **every** matching EMSX order (full status history), not just the latest.
- EMSX subscription updates are **merged** into the cache — Bloomberg sends a full paint on subscribe but later deltas carry only changed fields; a wholesale overwrite would blank fields like the ticker and break LME filtering downstream.
- Blotter pulls load **every** status (active/filled/cancelled/rejected), filtered only by LME ticker and today's date; status filtering is a display-only concern on the Fill Status screen.

See [`CLAUDE.md`](CLAUDE.md) for the full architectural rationale behind these behaviours.

# LME Order Entry — Trader User Guide

**Environment: PRODUCTION**

Import your LME orders from EATrade, stage them into Bloomberg EMSX, and track fills to settlement — all from one screen.

> **This tool places live orders.** Read *Launching the Tool* and *Entering Orders* before first use.

---

## 1. What This Tool Does

The LME Order Entry tool takes the LME orders you have prepared in EATrade and loads them into Bloomberg EMSX for you, then shows you fills and settlement prices as they come in. It replaces copying orders across by hand.

> ⚠️ **Important: the tool STAGES orders — it does not route them.**
> When you click **Stage Orders**, the orders appear in Bloomberg EMSX but are **NOT** sent to the market. You still route (send) them manually in EMSX exactly as you do today. Nothing reaches the market until you route it.

**The everyday flow, in one line:**

Open Bloomberg → launch the tool → paste orders from EATrade → pick the rows to send → Stage Orders → route them in EMSX → watch fills.

---

## 2. Before You Start

- **Bloomberg Terminal must be open and logged in on this PC.** The tool talks to Bloomberg through the Terminal — if it is not running, nothing will load.
- **The tool is already installed on this PC** (your IT team pulls it from the internal repository). You do not install anything day to day.
- **You are always in PRODUCTION.** Orders you stage are real. The green **PRODUCTION** badge stays on screen so you always know.

---

## 3. Launching the Tool

1. **Open Bloomberg Terminal and log in.** Do this first, every time. Leave it running in the background.
2. **Double-click `start-prod.bat`.** This is the launcher in the tool's folder. Your IT team can add a desktop shortcut to it.
3. **A black window titled "LME Bloomberg Bridge - PROD" opens. Leave it open.** This window is the bridge between the tool and Bloomberg. You can minimize it, but do **NOT** close it while you are working — closing it disconnects the tool.
4. **After a few seconds the LME Order Entry screen opens in your web browser** (the address looks like `http://localhost:8000`). If another program is already using that address, the bridge automatically picks the next free one (e.g. `8001`) and says so in the black window. You don't need to do anything. If the bridge is already running from earlier, it just reopens the page.
5. **Wait for the amber "loading" banner to clear.** While it reads *"Connecting…"* or *"Bloomberg order data is still loading"*, the tool is not ready yet. When the banner disappears, you are connected and can begin.

> **At the end of the day:** close the browser tab, then close the black bridge window. That fully shuts the tool down.

---

## 4. Entering Orders

1. **In EATrade, copy your order grid — including the header row.** The header row is required; the tool uses it to find the columns. Select the rows plus the header, then copy (Ctrl+C).
2. **Click the large paste box in the tool and press Ctrl+V.** Only rows where the market (MKT) is `LME_NTP` are imported. Any other rows are ignored automatically — you do not need to filter them out first.
3. **Review the imported orders and tick the ones you want to send.** Every row starts unticked — you deliberately choose what to stage. Use **Select All**, **Select None**, or **Select New** to tick quickly.
4. **Watch for the `⚠ IN EMSX` duplicate flag.** A flagged row means an order with that Order ID is already in EMSX. This is a safety check to stop you sending the same order twice. **Select New** ticks only the rows that are **not** already in EMSX. If you are unsure, use **Re-check** to refresh the comparison.
5. **Click Stage Orders and confirm.** You will see a summary of buys, sells and lots, plus the broker and account. Orders are staged as **Market-On-Close, Day** orders. Confirm to stage them into EMSX.

> ⚠️ **Then route the orders in Bloomberg EMSX.**
> Staging puts the orders in EMSX but does **NOT** send them. Switch to EMSX and route the staged orders manually. Until you do, nothing is working in the market.

---

## 5. Tracking Fills

After staging, the tool moves to the **Fill Status** screen. The top table, **EMSX Trade Details**, is live data from EMSX: each order, how much has filled, and the **Avg Price** it has filled at so far (`—` until it has fills).

- Use the **Active / Filled / All** tabs to choose which orders are shown. This only changes the view — it never changes what has actually filled.
- Click **Refresh Fills** to pull the latest fills from Bloomberg. It also picks up any new LME orders that appeared in EMSX since you started (for example, ones a teammate staged).
- **Summarize Selected** gives you a quick recap of the orders.
- The **Preliminary Settlement** table below is ready as soon as orders are staged. You don't need to wait for fills. It lists each live order at its ordered quantity, priced at the Bloomberg **settlement price**, with the **Settle Date** Bloomberg returned. Enter trader names per row or with **Apply to All**, then **Copy Table**. If the Settle Date shows **amber**, today's LME settlement isn't published yet (it's the prior day's price). Click **Refresh Settlement** later. **Red** means the price is stale or unavailable.
- The last column, **EMSX Check**, confirms the settlement price matches the price EMSX filled at, once an order is fully filled. **✓ Match** means they agree to the cent. **✗ +1.50** (for example) means EMSX filled 1.50 above the settlement price, so check before sending. **Awaiting fill** means the order isn't fully filled yet. Hover over the check to see both prices. This column is for your eyes only and is **not** included when you click **Copy Table**.
- When every order is completely filled, an **"All Filled — Get Settlement Prices"** button appears. Click it to load the LME settlement prices for those contracts.

---

## 6. Monitoring Orders Already in EMSX

If your LME orders are already in EMSX — because you staged them earlier, or a teammate did — you do not need to import them again to watch fills.

1. On the start screen, click **"Monitor orders already in EMSX"**.
2. The tool loads today's LME orders from the shared EMSX blotter and opens **Fill Status**. From there, tracking fills works exactly as in Section 5.

> **Starting a fresh session:** click **New Session** at any time to clear the screen and start over with a new paste or a new monitor pull. It does not cancel or change anything in EMSX.

---

## 7. If Something Looks Wrong

| What you see | What to do |
|---|---|
| The loading banner never clears / *"Connecting to the Bloomberg bridge"* | Check that Bloomberg Terminal is open and logged in, and that the black bridge window is still open. If the bridge window was closed, run `start-prod.bat` again. |
| Red banner: *"Can't reach the LME Bloomberg bridge"* | The black bridge window is closed or has stopped. Close it if it's still open, then double-click `start-prod.bat` again. The page reconnects by itself; no need to refresh. |
| *"The bridge is running but is not connected to Bloomberg"* | Open and log in to Bloomberg Terminal, then close the black bridge window and run `start-prod.bat` again. |
| The black window says *"could not start … every port it can use is taken"* | Close any other "LME Bloomberg Bridge" windows and try again. If that fails, restart the PC. If it still fails, send IT a screenshot of the black window. |
| *"No LME_NTP rows found"* after pasting | Re-copy from EATrade and make sure you included the header row. Only `LME_NTP` rows are imported. |
| A row shows `⚠ IN EMSX` | That order is already in EMSX. Check before resubmitting so you do not double it. Use **Select New** to tick only orders that are not already there. |
| **Monitor** button is greyed out | Bloomberg order data is still loading. Wait a few seconds for the amber banner to clear, then try again. |
| Fills are not updating | Click **Refresh Fills**. Fills come from Bloomberg, so there can be a short delay. |

---

## Appendix: One-Time Setup (for IT / reference)

Day to day you never touch this. It is here only in case the connection settings ever need to be recreated on a PC.

- In the tool's folder, copy the file `.env.prod.example` to `.env.prod`.
- Open `.env.prod` and fill in `EMSX_ACCOUNT` and `EMSX_BROKER` with the desk's values. The Bloomberg host/port defaults (`localhost:8194`) are correct for a standard Terminal.
- Save the file. **Never commit `.env.prod`** to the repository — it is intentionally ignored by git.

> **Need help?** If the tool will not connect and Bloomberg is running normally, contact your IT / support team and let them know whether the black bridge window showed any errors.

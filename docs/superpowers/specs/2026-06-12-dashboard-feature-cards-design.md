# Dashboard feature cards — design

Four new dashboard cards, drawn from patterns in leading finance apps (Origin,
Monarch, Rocket Money, Quicken, Wise) and grounded in this app's existing data.
Each is a **new toggleable + reorderable card** that plugs into the modular
dashboard system already built (see
`2026-06-12-modular-dashboard-cards-design.md`).

Build order: **(1) Quick wins → (2) Subscriptions → (3) Cashflow forecast →
(4) Net-worth trend.** Earlier = cheaper and reuses data already fetched; later =
needs new server work.

## Cross-cutting: what "a new card" requires

Every card below repeats the same integration (the modular system makes this
cheap):

1. `server/lib/settings.ts` — add a `dashboard.show.<key>` def (group
   `"Dashboard"`, `hidden: true`, `default: true`), and add the block key to
   `DASHBOARD_BLOCKS` (default order).
2. `web/src/pages/Dashboard.tsx` — add the section to the `blocks` map, wrapped in
   `<Customizable>`; it inherits drag-reorder + show/hide automatically.
3. New presentational component under `web/src/components/` for anything
   non-trivial (chart, list).

Place new block keys in `DASHBOARD_BLOCKS` where they should default in the
order: `recentActivity` and `topMerchants` after `spending`; `subscriptions`
after `upcoming`; `cashflow-forecast` after `upcoming`; `networth-trend` right
after `hero`.

---

## 1. Quick wins (3 small cards)

### 1a. Recent activity
**Ref:** Origin "Latest transactions" — logo · name · date · signed amount · "See all".
- **Data:** `api.transactions("")` already exists → take the first ~8 (newest by
  `createdAt`/`bookingDate`). No server change.
- **Card:** reuse `.lrow` row style + `BrandLogo`; amount in `.num` with
  `.pos`/`.neg`. Row click opens `TxnDrawer` (already wired on the Transactions
  page — reuse it). Header link "Transactions →".
- **Key:** `dashboard.show.recentActivity`. Effort: **S.**

### 1b. Top merchants
**Ref:** Origin/Monarch merchant rows; Wise category list with icon + %.
- **Data:** `DashboardDTO.topMerchants` (`{ merchant, total, count }`) is **already
  fetched and unused**. Logos: `topMerchants` carries no domain, so either (i)
  resolve client-side via `brand.ts` from the merchant name, or (ii) enrich the
  DTO server-side with the merchant `domain`. Prefer (i) first; fall back to a
  monogram when no logo.
- **Card:** `BarList`-style rows (merchant, £total, count as sub-label) OR
  logo-led rows. Top 6–8. Header link "Reports →".
- **Key:** `dashboard.show.topMerchants`. Effort: **S.**

### 1c. Savings rate
**Ref:** Copilot/YNAB headline health metric; Wise "average vs this month" callout.
- **Data:** already on the dashboard — `(income − spent) / income` for the month,
  with the existing month-over-month helper for the delta.
- **Card:** a single `Stat` tile (or fold into the existing stat grid): big `%`,
  delta "↑ 6pts vs last month", sub-line "£X saved of £Y income".
- **Key:** `dashboard.show.savingsRate`. Effort: **XS.** (Could ship as a 5th stat
  tile rather than its own block — decide at build.)

---

## 2. Subscriptions
**Ref:** Monarch Recurring (merchant logos pinned to due dates; tap → recent
charges). SaaS billing pages were weaker references (just "next billing date").

- **Data:** `api.recurring()` → `RecurringScheduleDTO[]`. Subscriptions =
  `direction === "out"`, `status !== "ignored"`, recurring cadence. Monthly total
  = sum of amounts normalised to monthly (`amount` for monthly; `/3`, `/12`,
  weekly `×52/12` for other cadences). `prevAmount != null` = **price increase**
  → the differentiator (Rocket Money paywalls this).
- **Card:**
  - Header: count + "£X/mo".
  - A logo row / compact list of the next renewals (`nextDue` soonest first):
    logo · name · `nextDue` · amount, with a coral "↑ £2" chip when
    `prevAmount`.
  - Header link "Recurring →".
- **Key:** `dashboard.show.subscriptions`. Effort: **M** (mostly reshaping
  existing data; no server change if `/recurring` already returns everything —
  confirm cadence normalisation helper exists in `server/lib/recurring.ts`).

---

## 3. 30-day cashflow forecast (flagship)
**Ref:** Quicken "Next 30 days" — Summary (Income / Expenses / Net) + date-ordered
reminders list + calendar with due-date dots. Monarch recurring calendar.

- **Data:** `api.upcoming(30)` already returns `items` (date, amount, direction,
  prevAmount) sorted by date, plus `billsNext30` / `incomeNext30`. Starting
  balance = `summary.available` (spendable).
- **The differentiator (new client calc, no server change):** walk the ordered
  `items` from today, accumulating a **running projected balance**, and surface
  the **low point**: "Lowest balance £-40 on 24 Jun, 4 days before payday."
  None of the reference apps draw the running balance — this is the edge.
- **Card:**
  - Summary line: In £ · Out £ · Net £ for the window.
  - A small projected-balance line/area (jade, coral segment if it crosses £0),
    or a simpler list-first layout: the date-ordered upcoming items with a
    cumulative balance column.
  - A reassurance/warning banner: green "On track — lowest £320 on the 28th" or
    amber "Tight — dips to £-40 on the 24th".
- **Key:** `dashboard.show.cashflowForecast`. Effort: **M.** (The
  `<Upcoming>` component already renders the items list; this card adds the
  running-balance projection + low-point banner on top.)

---

## 4. Net-worth trend (biggest lift)
**Ref:** Origin / Rocket Money / Monarch — big figure + signed delta + range pills
(1M/3M/6M/1Y/ALL) over a filled area line; assets-vs-liabilities split bar below.

- **Data gap:** the `Balance` table is `@@unique([accountId, type])` — it holds
  only the **latest** balance per account, **no history**. So:
  - **New table** (hand-applied SQL per CLAUDE.md): `NetWorthSnapshot`
    (`date` `YYYY-MM-DD` unique, `netWorth`, optional `assets`, `liabilities`,
    `liquid` Decimals). One row per day.
  - **Capture job:** after each `runFullSync` (and/or a daily scheduler tick),
    upsert today's snapshot from the same maths as `server/routes/summary.ts`
    (respecting the `networth.include*` flags).
  - **No backfill possible** — the chart starts empty and fills over time. Show
    an Origin-style placeholder ("Your net-worth graph builds as data comes in").
  - **Endpoint:** `GET /api/networth/history?range=6m` → `{ points: {date,
    netWorth}[] }`.
- **Card:** current net worth (reuse hero figure) + delta over range + range
  pills (`.badge` style) + Recharts area (jade up / coral down). Optional
  assets/liabilities split bar reusing `.progress`.
- **Key:** `dashboard.show.networthTrend`. Effort: **L** (new table + migration +
  capture job + endpoint + chart).

---

## Out of scope (YAGNI)
- Editing/cancelling subscriptions from the card (link out to Recurring).
- Backfilling net-worth history (impossible — no stored history).
- Per-account cashflow forecast (single combined spendable balance for v1).
- AI insights/anomaly detection (separate effort if wanted later).

## Verification (per card)
- `pnpm tsc --noEmit` + `pnpm exec vite build` clean.
- Each card toggles + reorders via Customize mode (inherits the modular system).
- Cashflow: hand-check the low-point against the upcoming items.
- Net-worth: snapshot row appears after a sync; chart renders once ≥2 points.

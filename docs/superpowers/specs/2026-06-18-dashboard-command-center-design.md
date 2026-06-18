# Dashboard Command Center — Design Spec

**Date:** 2026-06-18
**Status:** Approved (brainstorm) — pending implementation plan

## Goal

Turn the top of the dashboard into a permanent "command center" that answers two
questions every time the app is opened:

1. **Where am I on the overarching goal?** — the budget → save → invest journey
   (the UKPF flowchart already modelled by `PlanDTO`).
2. **What needs me right now?** — actionable signals: transactions needing a
   category, new transactions, subscriptions to confirm, overspend/low-balance
   warnings, and spare money to allocate.

This replaces the thin, conditional `SurplusNudge` band with two always-present,
purpose-built cards.

## Context (current state)

- `DashboardHome.tsx` renders `AccountsStrip` → `SurplusNudge` → `Dashboard`.
- `SurplusNudge` only appears when `plan.surplus > 0` and there's a current plan
  step with an `actionHint`; links to `/savings`.
- `PlanDTO` (`shared/types.ts`) already models the goal: steps
  `budget → ef_small → pension → ef_full → invest`, each with `state`,
  `progress {have,target,pct}`, plus a top-level `current` step and `surplus`.
  Served by `GET /api/plan` (`server/routes/plan.ts`).
- The only existing "needs review" signal is the uncategorised count, computed
  **client-side** inside `Transactions.tsx` / `TransactionsHome.tsx`
  (`category === "uncategorised" && !isRefundNote(note)`).
- Spend class (needs/wants/savings) is a static map in `shared/categoryClass.ts`.
- Schema changes are **hand-applied idempotent SQL** under
  `scripts/migrations/`, then mirrored into `prisma/schema.prisma` +
  `pnpm prisma generate`. There is no `prisma/migrations/` dir.

## Decisions (from brainstorm)

- **Composition:** two separate fixed cards — a slim **PlanProgressCard** and a
  **NeedsYou** inbox below it. Not part of the reorderable dashboard grid.
- **Notification state:** a **persistent `Insight` inbox** (the P1 "In-app
  insights queue" backlog item), not a purely-derived snapshot.
- **Insight kinds (v1):** `needs_category`, `new_transactions`,
  `new_subscription`, `overspent`, `surplus`.
- **Resolution:** **auto-resolve + manual dismiss/snooze**. The reconcile engine
  re-checks each open insight against live data and auto-closes ones no longer
  true; the user can also dismiss or snooze. Badges never show stale counts.
- **Surplus prompt:** becomes the `surplus` insight kind; `SurplusNudge` is
  **deleted**.
- **Item actions:** deep-link to the relevant existing page + per-row
  dismiss/snooze. No inline quick-actions in v1.

## Scope cuts (YAGNI)

- No inline quick-actions (confirm/categorise from the card) — deep-link only.
- No email/Telegram push — in-app only.
- Insights are **per-kind singletons** (one open row per kind, payload carries
  the count/summary), not one row per transaction.
- The two cards are not reorderable/toggleable.

---

## Component 1 — PlanProgressCard

Pure UI over the existing `PlanDTO`. **No backend change.**

- A 5-node stepper for `budget → ef_small → pension → ef_full → invest`:
  - `state === "done"` → filled node;
  - the `current` step → emphasised ring;
  - `coming` / `locked` → hollow node.
- Headline = the current step's `title` + `progress.pct`
  (e.g. "Building your emergency fund · 34%"), with a sub-line of
  `£have of £target` when `progress` is present.
- The whole card is a `<Link to="/savings">`.
- **No current step / nothing set up** (`plan.current == null`): render a slim
  "Set up your plan →" prompt linking to `/savings` instead of the stepper.

File: `web/src/components/PlanProgressCard.tsx`. Data via `api.plan()`
(already exists).

---

## Component 2 — NeedsYou inbox

### Data model — `Insight` table

Hand-applied SQL migration `scripts/migrations/2026-06-18-insights.sql`
(idempotent `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`), then
mirrored into `prisma/schema.prisma`.

| column | type | notes |
|---|---|---|
| `id` | text PK | cuid |
| `kind` | text | one of the 5 kinds |
| `payload` | jsonb | `{ count?, summary?, amount?, link, … }` per kind |
| `createdAt` | timestamptz | default now |
| `updatedAt` | timestamptz | bumped on payload refresh |
| `readAt` | timestamptz null | digest "caught up" marker (`new_transactions`) |
| `resolvedAt` | timestamptz null | auto-closed (condition no longer true) |
| `dismissedAt` | timestamptz null | manual dismiss |
| `snoozedUntil` | timestamptz null | hidden until this time |

Index on `(kind)` filtered to open rows is unnecessary at single-user scale; a
plain index on `kind` suffices. **Open** = `resolvedAt IS NULL AND dismissedAt
IS NULL`. **Visible** = open AND (`snoozedUntil IS NULL OR snoozedUntil <= now`).

Each kind is a **singleton**: the reconcile engine finds the existing open row
of a kind (if any) and refreshes it, or creates one — never duplicates.

### Reconcile engine — `server/lib/insights.ts`

A pure module that, given current condition inputs and the set of open `Insight`
rows, returns the actions to take (create / refreshPayload / resolve). The route
layer performs the DB writes; the engine itself is data-in/data-out so it is unit
testable without a live DB.

Condition inputs (gathered by the route from existing helpers):

- `uncategorisedCount` — settled txns with `category === "uncategorised"` and not
  a refund note.
- `newTxnCount` — settled txns imported since the `insights.txnsSeenAt` setting.
- `autoSubCount` — recurring schedules with `status === "auto"`.
- `overspend` — worst budget category over 100% (from `personalSpendByCategory`)
  **or** `available < billsDue`; `null` when none.
- `surplus` — `{ amount, hint }` when `plan.surplus > 0` and the current step has
  an `actionHint`; else `null`.

Per-kind reconcile rules:

| kind | open while | link | payload |
|---|---|---|---|
| `needs_category` | `uncategorisedCount > 0` | `/transactions?cat=uncategorised` | `{count}` |
| `new_subscription` | `autoSubCount > 0` | `/recurring` | `{count}` |
| `overspent` | `overspend != null` | `/budgets` | `{summary, amount}` |
| `surplus` | `surplus != null` | `/savings` | `{amount, hint}` |
| `new_transactions` | resolves on **read**, not condition (see below) | `/transactions` | `{count, sinceTs}` |

**`new_transactions` special case:** new transactions don't "un-happen", so this
insight does not auto-resolve from a data condition. Instead:

- The reconcile creates/refreshes it while `newTxnCount > 0`.
- It resolves when the user **reads** it: a `read` action sets `readAt` and bumps
  the `insights.txnsSeenAt` setting to "now", so `newTxnCount` recomputes to 0 on
  the next reconcile and the insight stays closed.
- Deep-linking into it (the row's chevron) also issues the `read` action.

### DTO + routes

`shared/types.ts`:

```ts
export type InsightKind =
  | "needs_category" | "new_transactions" | "new_subscription"
  | "overspent" | "surplus";

export interface InsightDTO {
  id: string;
  kind: InsightKind;
  title: string;        // rendered server-side from kind + payload
  detail: string | null;
  count: number | null; // for the badge
  link: string;         // deep-link target
  severity: "warn" | "review" | "opportunity" | "digest";
  createdAt: string;
}
```

Routes (`server/routes/insights.ts`):

- `GET /api/insights` → run reconcile (create/refresh/auto-resolve), then return
  the **visible** insights as `InsightDTO[]`, sorted by severity then recency:
  `warn` (overspent) → `review` (needs_category) → `review` (new_subscription) →
  `opportunity` (surplus) → `digest` (new_transactions).
- `PATCH /api/insights/:id` with `{ action: "dismiss" | "snooze" | "read", until? }`:
  - `dismiss` → `dismissedAt = now`;
  - `snooze` → `snoozedUntil = until` (server validates an ISO future date;
    client offers "Tomorrow" / "Next week");
  - `read` → `readAt = now`; for `new_transactions` also bump `insights.txnsSeenAt`.

Post-sync, the sync pipeline calls the same reconcile so Telegram/Gmail/bank-sync
changes surface without waiting for a dashboard load. The on-load reconcile is the
correctness backbone; the post-sync call is a freshness optimisation.

`txnsSeenAt` is stored via the existing string-settings layer
(`STRING_SETTING_DEFS` in `server/lib/settings.ts`), default empty → treated as
"epoch" so the first run reports recent imports.

### Front-end — `web/src/components/NeedsYou.tsx`

- `useQuery(["insights"], api.insights)`.
- Each row: icon (per kind) + title + detail + count badge + chevron (the row is
  a `<Link to={insight.link}>`) + a `⋮` popover trigger.
- `⋮` popover (in-app, not `window.*`): **Dismiss**, **Snooze → Tomorrow**,
  **Snooze → Next week**. Each fires `PATCH /api/insights/:id` with optimistic
  cache update + invalidation.
- Tapping the row body issues a `read` action (fire-and-forget) before
  navigating, so digest insights clear.
- **Empty state:** when no visible insights, render a calm
  "You're all caught up ✓" line (the card stays present, layout intentional).

### `DashboardHome.tsx`

Replace `<SurplusNudge/>` with `<PlanProgressCard/>` then `<NeedsYou/>`. Delete
`web/src/components/SurplusNudge.tsx` and its import.

---

## Testing

`server/lib/insights.test.ts` (node --test, pure functions, injected data):

- each kind creates an open insight when its condition is true;
- refreshes the payload count when the count changes (no duplicate row);
- auto-resolves (`resolvedAt`) when the condition goes false;
- `new_transactions` does **not** auto-resolve on condition but resolves on
  `read` (and the `txnsSeenAt` bump zeroes the next count);
- a snoozed insight is hidden until `snoozedUntil`, then reappears;
- a dismissed insight stays closed and is not recreated while the condition holds
  (dismiss is sticky for the current open instance; a fresh condition cycle after
  resolve may create a new one).

Sorting: a fixture with all five kinds returns them in the documented severity
order.

Run: `node --test --import tsx server/lib/insights.test.ts`.

## Constraints honoured

- Hand-applied SQL migration, mirrored to `schema.prisma` (no `prisma migrate`).
- In-app popover for dismiss/snooze (no `window.prompt/confirm/alert`).
- `noUnusedLocals`: remove `SurplusNudge` import on deletion.
- Degrades gracefully: if `/api/plan` or `/api/insights` is empty/unavailable the
  cards render their set-up / all-caught-up states; no AI calls are added.
- After changes: `pnpm tsc --noEmit -p tsconfig.json` + `pnpm exec vite build`;
  server tests as above.

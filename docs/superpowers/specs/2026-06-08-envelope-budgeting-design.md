# Envelope Budgeting (Custom Categories & Groups) — Design

**Date:** 2026-06-08
**Status:** Approved (pending spec review)
**Replaces:** the hardcoded category list + simple per-category `Budget` table.
**Followed by:** a separate spec for smart/AI categorisation onto these categories.

## Goal

Replace the app's 6 hardcoded categories with the user's real, personalised
**Aspire-style envelope budget**: custom categories organised into groups, each
with a recurring monthly allocation and an optional goal, and a **rolling
available balance** that carries over month to month. Seeded from the user's
existing Aspire spreadsheet (`~/Downloads/budget.xlsx`).

## Decisions (from brainstorming)

- **Full envelope model**: groups → categories, monthly allocation + optional
  goal, rolling available balance, inter-category transfers.
- **Auto-recurring fill**: each category's `monthlyAmount` is auto-credited every
  month; a given month can be overridden via an `Allocation` row.
- **Spend scope = PERSONAL accounts only** (banks + cash; excludes BUSINESS and
  `transfer`-categorised rows).
- Categories referenced **by name** (string), so existing `Transaction.category`
  / `categoryOverride` columns keep working — minimal churn.
- Auto-categorisation is **deferred to the next spec**; until then synced
  transactions default to **"Uncategorised"** and are assigned manually.

## Data model (Prisma / Postgres)

```prisma
model CategoryGroup {
  id         Int        @id @default(autoincrement())
  name       String     @unique
  sortOrder  Int        @default(0)
  categories Category[]
}

model Category {
  id            Int           @id @default(autoincrement())
  name          String        @unique
  group         CategoryGroup @relation(fields: [groupId], references: [id])
  groupId       Int
  monthlyAmount Decimal       @default(0)
  goal          Decimal?
  sortOrder     Int           @default(0)
  archived      Boolean       @default(false)
  allocations   Allocation[]
}

model Allocation {
  id         Int      @id @default(autoincrement())
  category   Category @relation(fields: [categoryId], references: [id])
  categoryId Int
  month      String   // "YYYY-MM"
  amount     Decimal
  @@unique([categoryId, month])
}

model CategoryTransfer {
  id        Int      @id @default(autoincrement())
  fromName  String
  toName    String
  month     String
  amount    Decimal
  note      String?
  createdAt DateTime @default(now())
}

model Setting {
  key   String @id
  value String
}
```

`Setting` holds `budgetStartMonth` (default = current month at setup). `income`
and `transfer` remain reserved effective-category values (not envelopes); a
seeded `Uncategorised` category is the catch-all. The old `Budget` model is
removed.

## Envelope math (pure, unit-tested) — `server/lib/envelope.ts`

Given the categories, allocation overrides, transfers, and the set of effective
personal transactions, compute per category as of a target month `M`
(inclusive), iterating months from `budgetStartMonth`:

- `allocated(cat, m) = Allocation[cat,m] ?? cat.monthlyAmount` (for m ≥ start).
- `spent(cat, m) = Σ −amount` of personal debits whose effective category =
  `cat.name`, in month `m` (transfers/income excluded by virtue of category).
- `available(cat) = Σ_{start..M} (allocated − spent) + transfersIn(cat,≤M) − transfersOut(cat,≤M)`.
- Current-month view row: `{ name, group, allocated: allocated(cat,M),
  spent: spent(cat,M), available, goal }`.

Pure functions: `monthsBetween(start, end)`, `resolveAllocated(overrides, cat, month)`,
`computeEnvelopes(categories, allocations, transfers, txns, startMonth, asOfMonth)`.

## Backend routes (`/api`)

- `GET /categories` → `[{ id, name, sortOrder, categories: [{ id, name,
  monthlyAmount, goal, sortOrder, archived }] }]` (groups, ordered). Powers
  dropdowns + the manager. Excludes archived unless `?all=1`.
- `POST /categories` `{ name, groupId, monthlyAmount?, goal? }`; `PATCH
  /categories/:id` (name/group/monthlyAmount/goal/sortOrder/archived); `DELETE
  /categories/:id` (block if it has transactions — archive instead). On
  **rename**, `updateMany` Transaction.category and categoryOverride old→new.
- `POST /category-groups` / `PATCH /category-groups/:id` / `DELETE` (only if empty).
- `GET /envelopes?month=YYYY-MM` → groups → category rows from
  `computeEnvelopes`; defaults to current UK-local month.
- `PUT /allocations/:categoryId/:month` `{ amount }` → upsert an override.
- `POST /category-transfers` `{ fromName, toName, month, amount, note? }`.
- A names list endpoint reused by the manual-txn + Telegram category pickers
  (active category names + `income`/`transfer`).

`categorize.ts`: `SPENDING_CATEGORIES`/`CATEGORIES` stop being the source of
truth for the *set*; categorisation now resolves against DB category names. For
this spec the keyword categoriser is retired from sync (sync sets
`Uncategorised`); the constant list is kept only for `income`/`transfer`
handling and the next spec.

## Frontend

- **Budgets page → Envelope view** (`Budgets.tsx` rebuilt): a month selector;
  collapsible **groups**; each category row shows **allocated / spent /
  available** with a goal progress bar (green/amber/red by available vs goal or
  vs allocated). Inline edit of monthly amount and goal. A **"Move money"**
  control opens the transfer dialog (from → to, amount). Group/category totals.
- **Categories manager** (new `Categories.tsx` or a section on Manage): add/
  rename/regroup/reorder/archive categories and groups.
- **Dropdowns**: `Transactions` category override, `AddTransaction` dialog, and
  the Telegram picker all load names from `/api/categories` (+ `income`,
  `transfer`). `CATEGORY_OPTIONS` becomes data-driven.
- Dashboard `byCategory` is unchanged structurally (keyed by effective category
  name) — it just reflects the richer category set.

## Seed (the user's Aspire categories)

Seed groups → categories (monthlyAmount, goal) from the captured Configuration:

- **Halima Expenses:** Halima expenses (200), Arabic Intensive Fees (60, goal 540)
- **Mansoor Expenses:** Cloud Services (11), Mobile Phone (29), Mansoor expenses
  (50), Mobile Phone Contract (16, goal 192), Fuel (50)
- **Household:** Groceries (250)
- **Monthly Bills:** Water (25.14, goal 251.13), Electric & Gas (121.70),
  Car Finance (116.63, goal 2099.54), Car Insurance (70.56, goal 281.84),
  Broadband (23.99, goal 191.92), Council Tax (135), Rent (500), Kendamil (22),
  Maryam Football (22), Meow Meow (50)
- **Yearly Bills:** Car Maintenance fund (40, goal 480), Amazon Prime (10, goal 95)
- **Long-term Funds:** Clothing (0), Home Maintenance (0), Emergency Fund (0, goal 2000)
- **System:** Uncategorised (0)

(Aspire's "Credit Card Payments" float envelopes are **out of scope v1**.) Seed
is idempotent (upsert by name) and runs as a script + once on Railway.

## Migration / data handling

- New tables created; old `Budget` table dropped (its `monthlyLimit` values are
  copied into the matching seeded `Category.monthlyAmount` first where names
  align: groceries→Groceries, etc.).
- `budgetStartMonth` seeded = current month.
- Existing transactions keep their strings; explicit `updateMany` mapping of the
  old spending categories: `groceries`→`Groceries`; `eating-out`, `transport`,
  `bills`, `shopping`, `other` → `Uncategorised`. `income` and `transfer` are
  left untouched (still reserved). Same mapping applied to `categoryOverride`.
- Schema applied to the live Railway DB via idempotent SQL (per workflow pref).

## Error handling

- Delete category with transactions → 409, suggest archive.
- Transfer/allocation validate amount ≥ 0 and that category names exist.
- Envelope compute tolerates missing allocations (falls back to monthlyAmount)
  and an empty transaction set.

## Testing

Unit-test `server/lib/envelope.ts` thoroughly: month iteration, allocation
override vs default, rollover accumulation across months, transfers in/out,
goal handling, personal-only/transfer exclusion (operate on already-effective,
already-personal-filtered inputs). CRUD + UI validated by running.

## Out of scope (this spec)

Smart/AI auto-categorisation (next spec), Aspire credit-card-payment float
envelopes, report tabs, scheduled/automatic month rollover jobs (computed on
read instead), multi-currency.

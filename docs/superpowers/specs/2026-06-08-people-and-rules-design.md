# Category Keys, People & Rules Engine — Design

**Date:** 2026-06-08
**Status:** Approved (pending spec review)
**Builds on:** the envelope budgeting feature (categories, groups, allocations, transfers).

## Goal

Make categorisation dynamic and per-person: give categories stable **keys**
(rename-safe), add a **People** dimension assigned per transaction (nullable),
and a **rules engine** that auto-assigns category + person from merchant/keyword
matches (overridable). Replace the prompt-box management with proper UI.

## Decisions (from brainstorming)

- **Category `key`** (immutable slug) + `name` (display). All references switch
  to key: `Transaction.category`/`categoryOverride`, `CategoryTransfer`, the
  envelope match. Reserved keys `income`/`transfer` stay special; `Uncategorised`
  is a real category with key `uncategorised`.
- **`Person`** table, seeded **you, halima, maryam, maariyah, household**.
  `Transaction.personKey` is **nullable** (transfers/card payments stay person-less).
- Person and category are **assigned automatically by rules**, overridable.
- **Rules** set base `category` and fill `personKey` **when null**; manual edits
  are protected (manual category → `categoryOverride`; manual person = a non-null
  `personKey` that re-apply won't clobber).
- Proper **forms/dialogs** for category, people, and rule management.

## Data model (Prisma / Postgres)

`Category` (changed): add `key String @unique`. `name` stays `@unique` (display).
`CategoryGroup` unchanged. `Allocation` already FK by `categoryId` (unchanged).

`CategoryTransfer` (changed): `fromName`/`toName` → `fromKey`/`toKey`.

`Transaction` (changed): add `personKey String?`. `category`/`categoryOverride`
now hold category **keys** (data migrated).

New:
```prisma
model Person {
  id        Int     @id @default(autoincrement())
  key       String  @unique
  name      String
  sortOrder Int     @default(0)
  archived  Boolean @default(false)
}

model Rule {
  id          Int      @id @default(autoincrement())
  matchText   String   // lowercased substring matched against merchant/creditor/debtor/remittance
  categoryKey String?
  personKey   String?
  priority    Int      @default(0)
  createdAt   DateTime @default(now())
}
```
A `Rule` must set at least one of `categoryKey`/`personKey`.

## Rule engine (pure, unit-tested) — `server/lib/rules.ts`

- `slug(name)` → lowercased, hyphenated key (`"Electric & Gas"` → `electric-gas`).
- `applyRules(text, rules)` → `{ categoryKey?: string; personKey?: string }`.
  Rules sorted by `priority` desc then `createdAt` asc. Walk in order; the first
  rule whose `matchText` is contained in `text.toLowerCase()` **and** has a
  `categoryKey` sets the category; independently the first such rule with a
  `personKey` sets the person. Stop once both resolved. Pure; no I/O.

## Assignment & precedence

- **Sync** (`syncAccount`): for each transaction compute `text` (merchant /
  creditor / debtor / remittance), run `applyRules`. Set base
  `category = result.categoryKey ?? (amount > 0 ? "income" : "uncategorised")`.
  Set `personKey = result.personKey ?? null` **only when the existing row has no
  personKey** (don't clobber manual). `categoryOverride` is never touched by sync.
- **Effective category** = `categoryOverride ?? category` (unchanged helper; now
  key-valued). Manual category edit writes `categoryOverride` (a key).
- **Manual person edit** writes `personKey` directly (or null to clear).
- **`POST /rules/apply`**: re-runs over all transactions — overwrites base
  `category` (manual override protected), fills `personKey` where currently null.

## Backend routes (`/api`)

- **Categories** (extend existing route): `GET /categories` returns `key` + `name`
  per category. `POST /categories` `{ name, groupId, monthlyAmount?, goal? }` →
  `key = slug(name)` (reject on key collision). `PATCH /categories/:id` updates
  name/group/monthlyAmount/goal/sortOrder/archived (**not** key). `DELETE`
  blocked (409) if any transaction references the key → archive instead.
  `GET /category-names` → `[{ key, name }]` active + `{income},{transfer}`.
- **People** (`server/routes/people.ts`): `GET /people`; `POST /people` `{ name }`
  (`key = slug(name)`); `PATCH /people/:id` (name/sortOrder/archived); `DELETE`
  blocked (409) if referenced → archive.
- **Rules** (`server/routes/rules.ts`): `GET /rules`; `POST /rules`
  `{ matchText, categoryKey?, personKey?, priority? }` (≥1 of cat/person);
  `PATCH /rules/:id`; `DELETE /rules/:id`; `POST /rules/apply` → `{ categorised,
  personed }` counts.
- **Transactions**: `PATCH /transactions/:id` accepts `{ category?, personKey? }`
  (`category` validated against DB keys + income/transfer; `personKey` validated
  against people keys or null). `GET /transactions` returns `personKey`,
  `personName`, and category `key`; accepts `?person=` filter (`none` ⇒ null).
- **Envelopes / dashboard**: optional `?person=` filter scoping spend to one
  person (or `none`).

Envelope compute (`envelope.ts`) matches on category **key** now (rename the
internal field from name to key; transactions' effective category is a key).

## Frontend

- **Categories manager** (`Categories.tsx`): a **dialog** form (name, group,
  monthly amount, goal) for add/edit; key shown read-only; archive. No prompts.
- **People manager** (`People.tsx`, new + nav): list, add/rename/archive via a
  small dialog.
- **Rules manager** (`Rules.tsx`, new + nav): table of rules (match → category +
  person, priority); add/edit dialog; delete; **"Re-apply rules now"** button.
- **Transactions**: a **Person** dropdown column (people + "—") beside the
  category dropdown — both edit in place; a person filter control; category
  dropdown shows names but submits keys.
- **Budget**: optional person filter (reuses the envelopes `?person=`).
- **Telegram bot**: on cash-txn create, run `applyRules` to set category + person
  too (falls back to `uncategorised`/null).
- Category/person pickers everywhere submit **keys**, render **names**.

## Migration (idempotent SQL, controller-applied to Railway)

1. `ALTER TABLE "Category" ADD COLUMN "key" TEXT;` backfill `key = slug(name)`
   for every category; add UNIQUE; ensure `uncategorised` exists.
2. Remap `Transaction.category`/`categoryOverride` from name → key via a join to
   `Category(name→key)`; `income`/`transfer` pass through.
3. `ALTER TABLE "CategoryTransfer"` rename `fromName`/`toName` → `fromKey`/`toKey`
   and convert any existing values name→key.
4. `ALTER TABLE "Transaction" ADD COLUMN "personKey" TEXT;` (nullable).
5. `CREATE TABLE "Person"` + seed `you, halima, maryam, maariyah, household`
   (keys = those slugs; names "You","Halima","Maryam","Maariyah","Household").
6. `CREATE TABLE "Rule"`.
All guarded (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, column-existence checks)
so re-runs are safe.

## Error handling

- Category/person delete blocked (409) when referenced — archive instead.
- Rule must set ≥1 of category/person (400 otherwise); unknown category/person
  keys in a rule or transaction PATCH → 400.
- Re-apply rules tolerant of zero rules (no-op).

## Testing

Unit-test `server/lib/rules.ts`: `slug` (special chars, spacing), `applyRules`
(priority ordering, category-vs-person independence, no-match, partial match,
case-insensitivity). Update `envelope.test.ts` to key-based names. Route + UI
validated by running.

## Out of scope (this spec)

AI/LLM categorisation (rules are deterministic/free), per-person allocations
(envelopes stay per-category; person is a reporting/filter lens on spend),
regex/amount-condition rules (substring match only), Aspire credit-card float
envelopes.

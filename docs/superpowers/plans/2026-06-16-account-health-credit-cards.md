# Account Health — Credit Cards + Review Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Treat credit cards distinctly in account health (auto-detected from GoCardless + manual override), so a card's negative balance isn't flagged as an overdraft; plus two review follow-ups (smarter source picker, health-query invalidation).

**Architecture:** Two additive `Account` columns (`cashAccountType` auto-captured from GoCardless, `creditCard` manual override) feed a shared pure `isCreditCard()` helper used by both the accounts DTO and the health endpoint. The runway + buffer checks skip credit cards; cashflow becomes their debt-growth signal. A manual toggle in account settings sets the override.

**Tech Stack:** TypeScript, Express 5, Prisma v6/Postgres (Railway), React 19, `node:test` + `tsx`. Spec addendum: `docs/superpowers/specs/2026-06-16-account-health-design.md` (§ "Addendum (2026-06-16): Credit cards"). Builds on the already-implemented account-health feature (`server/lib/health/`, `web/src/components/HealthRing.tsx`, etc.).

**Conventions (read before starting):**
- Node env for every command: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"` then **pnpm** (never npm).
- Schema changes are **hand-applied SQL** (`scripts/migrations/`), NOT `prisma migrate`. Apply with `export $(grep -E '^DATABASE_URL=' .env | xargs)` then `bash scripts/migrations/apply.sh <file>`, then hand-edit `prisma/schema.prisma` to match, then `pnpm prisma generate`.
- After code changes: `pnpm tsc --noEmit -p tsconfig.json` and `pnpm exec vite build`. `noUnusedLocals` is on.
- Full server suite: `pnpm test` (script now correctly globs `'server/**/*.test.ts'` recursively).
- **Commits to `main` only when the user asks.** Verify each task; do not commit. One gated commit at the end.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `scripts/migrations/2026-06-16-account-credit-card.sql` | Add `cashAccountType`, `creditCard` columns | **Create** |
| `prisma/schema.prisma` | `Account` model | Add the two fields |
| `shared/accountKind.ts` | Pure `isCreditCard()` helper | **Create** |
| `shared/accountKind.test.ts` | helper test | **Create** |
| `shared/types.ts` | `AccountDTO` | Add `isCreditCard` |
| `server/gocardless/types.ts` | `GcAccountDetails` | Add `cashAccountType` |
| `server/routes/connect.ts` | account-details writes | Store `cashAccountType` (2 sites) |
| `server/routes/accounts.ts` | `toAccountDTO`, PATCH, `/accounts/health` | DTO field; `creditCard` patch; pass `isCreditCard` |
| `server/lib/health/types.ts` | `HealthAccount` | Add optional `isCreditCard` |
| `server/lib/health/checks/runway.ts` | skip cards | Modify |
| `server/lib/health/checks/buffer.ts` | skip cards | Modify |
| `server/lib/health/checks/cashflow.ts` | card-aware copy | Modify |
| `server/lib/health/checks.test.ts` | card tests | Add cases |
| `server/lib/health/recommend.ts` | `pickSource` covers-first (#2) | Modify |
| `server/lib/health/recommend.test.ts` | covers-first test | Add case |
| `web/src/api.ts` | `patchAccount` | Add `creditCard` |
| `web/src/pages/Accounts.tsx` | settings dialog | Add "Credit card" toggle |
| 7 invalidation sites | `["accounts-health"]` (#3) | Modify |
| `scripts/backfill-account-types.ts` | best-effort `cashAccountType` backfill | **Create** |

---

## Task 1: Database migration + schema

**Files:**
- Create: `scripts/migrations/2026-06-16-account-credit-card.sql`
- Modify: `prisma/schema.prisma` (Account model, ~lines 118–143)

- [ ] **Step 1: Write the migration SQL**

Create `scripts/migrations/2026-06-16-account-credit-card.sql`:

```sql
-- Credit-card support for account health: capture the bank-reported account type
-- (ISO 20022 cashAccountType, e.g. "CARD") and allow a manual override, so a card's
-- negative balance is treated as debt rather than an overdraft.
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "cashAccountType" TEXT;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "creditCard" BOOLEAN;
```

- [ ] **Step 2: Apply it to the database**

Run:
```bash
eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"
export $(grep -E '^DATABASE_URL=' .env | xargs)
bash scripts/migrations/apply.sh scripts/migrations/2026-06-16-account-credit-card.sql
```
Expected: `Applying ... Done.` (idempotent — safe to re-run.)

- [ ] **Step 3: Hand-edit the Prisma schema to match**

In `prisma/schema.prisma`, in the `Account` model, add these two lines after `balanceType String?`:
```prisma
  cashAccountType String?
  creditCard      Boolean?
```

- [ ] **Step 4: Regenerate the Prisma client**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm prisma generate`
Expected: "Generated Prisma Client".

- [ ] **Step 5: Verify it compiles**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm tsc --noEmit -p tsconfig.json`
Expected: no errors.

---

## Task 2: Shared `isCreditCard` helper + DTO field

**Files:**
- Create: `shared/accountKind.ts`
- Create: `shared/accountKind.test.ts`
- Modify: `shared/types.ts` (`AccountDTO`, ~line 284)
- Modify: `server/routes/accounts.ts` (`AccountWithBalances` ~19–27, `toAccountDTO` ~29–51)

- [ ] **Step 1: Write the failing test**

Create `shared/accountKind.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isCreditCard } from "./accountKind.ts";

test("isCreditCard: manual override wins over the bank type", () => {
  assert.equal(isCreditCard({ creditCard: true, cashAccountType: "CACC" }), true);
  assert.equal(isCreditCard({ creditCard: false, cashAccountType: "CARD" }), false);
});

test("isCreditCard: falls back to the bank-reported type", () => {
  assert.equal(isCreditCard({ creditCard: null, cashAccountType: "CARD" }), true);
  assert.equal(isCreditCard({ cashAccountType: "CACC" }), false);
  assert.equal(isCreditCard({}), false);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; node --test --import tsx shared/accountKind.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `shared/accountKind.ts`:

```ts
// Is an account a credit card? An explicit user override wins; otherwise fall back
// to the bank-reported ISO-20022 cash-account type ("CARD"). Pure — shared by the
// accounts DTO and the health engine so both agree.
export interface CardLike {
  creditCard?: boolean | null;
  cashAccountType?: string | null;
}

export function isCreditCard(a: CardLike): boolean {
  return a.creditCard ?? a.cashAccountType === "CARD";
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; node --test --import tsx shared/accountKind.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add `isCreditCard` to `AccountDTO`**

In `shared/types.ts`, in the `AccountDTO` interface, add after `balanceType: string | null;`:
```ts
  isCreditCard: boolean;
```

- [ ] **Step 6: Wire it through `toAccountDTO`**

In `server/routes/accounts.ts`:

Add an import near the top (after the existing `displayName` import):
```ts
import { isCreditCard } from "../../shared/accountKind.ts";
```

In the `AccountWithBalances` type, add these two fields (they exist on the DB row now):
```ts
  cashAccountType: string | null;
  creditCard: boolean | null;
```

In `toAccountDTO`, add to the returned object (after `balanceType: a.balanceType,`):
```ts
    isCreditCard: isCreditCard({ creditCard: a.creditCard, cashAccountType: a.cashAccountType }),
```

- [ ] **Step 7: Verify it compiles**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm tsc --noEmit -p tsconfig.json`
Expected: no errors.

---

## Task 3: Capture `cashAccountType` from GoCardless

**Files:**
- Modify: `server/gocardless/types.ts` (`GcAccountDetails`, ~45–52)
- Modify: `server/routes/connect.ts` (~119–136 and ~187–191)

- [ ] **Step 1: Extend the GoCardless type**

In `server/gocardless/types.ts`, add `cashAccountType` to `GcAccountDetails.account` (the `/details` endpoint already returns it; we just type it):
```ts
export interface GcAccountDetails {
  account?: {
    iban?: string;
    name?: string;
    currency?: string;
    ownerName?: string;
    cashAccountType?: string;
  };
}
```

- [ ] **Step 2: Store it at the finalize upsert site**

In `server/routes/connect.ts`, in the `db.account.upsert` (~119–136), add `cashAccountType` to BOTH the `create` and `update` objects (after each `ownerName: details?.account?.ownerName,`):
```ts
          cashAccountType: details?.account?.cashAccountType,
```

- [ ] **Step 3: Store it at the streamed-backfill update site**

In `server/routes/connect.ts` (~188–191), change the update `data` to include it:
```ts
            data: { iban: d?.iban, name: d?.name, currency: d?.currency, ownerName: d?.ownerName, cashAccountType: d?.cashAccountType },
```

- [ ] **Step 4: Verify it compiles**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm tsc --noEmit -p tsconfig.json`
Expected: no errors.

---

## Task 4: Health — skip checks for credit cards

**Files:**
- Modify: `server/lib/health/types.ts` (`HealthAccount`)
- Modify: `server/lib/health/checks/runway.ts`, `checks/buffer.ts`, `checks/cashflow.ts`
- Modify: `server/lib/health/checks.test.ts`
- Modify: `server/routes/accounts.ts` (`/accounts/health` handler — populate `isCreditCard`)

- [ ] **Step 1: Write the failing tests**

In `server/lib/health/checks.test.ts`, add these tests at the end of the file:

```ts
test("runway: credit card → skipped (no overdraft/runway semantics)", () => {
  const card = { ...A, balance: -500, isCreditCard: true };
  assert.equal(runwayCheck(card, ctx({}, baseFund({ committed: 100, balance: -500 }))), null);
});

test("buffer: credit card with negative balance → skipped (debt, not overdraft)", () => {
  const card = { ...A, balance: -500, isCreditCard: true };
  assert.equal(bufferCheck(card, ctx()), null);
});

test("cashflow: credit card draining → card-specific copy", () => {
  const card = { ...A, isCreditCard: true };
  const r = cashflowCheck(card, ctx({ netFlowByAccount: new Map([["a", -200]]) }));
  assert.equal(r?.severity, "attention");
  assert.equal(r?.title, "Card balance growing");
  assert.match(r!.why, /more is charged than paid off/);
});
```

(The `HealthAccount` fixture `A` has no `isCreditCard`; the field is optional and defaults to undefined/false for non-card tests — existing cases are unaffected.)

- [ ] **Step 2: Run to confirm failure**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; node --test --import tsx server/lib/health/checks.test.ts`
Expected: FAIL — `isCreditCard` not on the type / new copy not produced.

- [ ] **Step 3: Add the field to `HealthAccount`**

In `server/lib/health/types.ts`, add to the `HealthAccount` interface (after `informational: boolean;`):
```ts
  isCreditCard?: boolean; // a credit card: negative balance is debt, not an overdraft
```

- [ ] **Step 4: Skip runway for cards**

In `server/lib/health/checks/runway.ts`, add as the first line of the function body (before `const f = ...`):
```ts
  if (account.isCreditCard) return null; // a card isn't funded from its own balance
```

- [ ] **Step 5: Skip buffer for cards**

In `server/lib/health/checks/buffer.ts`, add as the first line of the function body (before `if (account.balance >= 0)`):
```ts
  if (account.isCreditCard) return null; // a negative card balance is debt, not an overdraft
```

- [ ] **Step 6: Make cashflow card-aware**

In `server/lib/health/checks/cashflow.ts`, replace the whole `cashflowCheck` body with:
```ts
export const cashflowCheck: HealthCheck = (account, ctx) => {
  const net = ctx.netFlowByAccount.get(account.id);
  if (net == null || net >= 0) return null;
  const out = round2(-net);
  if (account.isCreditCard) {
    return { key: "cashflow", severity: "attention", title: "Card balance growing",
      why: `On average £${money(out)}/mo more is charged than paid off`,
      recommendation: "Pay off more than you spend on this card to stop the balance growing" };
  }
  return { key: "cashflow", severity: "attention", title: "Cashflow",
    why: `On average £${money(out)}/mo more goes out than comes in`,
    recommendation: "Move a recurring bill to an account with spare cash, or trim your biggest discretionary spend" };
};
```

- [ ] **Step 7: Populate `isCreditCard` in the health endpoint**

In `server/routes/accounts.ts`, in the `/accounts/health` handler, update the `accounts` mapping to set `isCreditCard` (the `isCreditCard` helper is already imported in Task 2). Change the mapped object to include it after `informational: a.informational,`:
```ts
      isCreditCard: isCreditCard({ creditCard: a.creditCard, cashAccountType: a.cashAccountType }),
```

- [ ] **Step 8: Run tests + full suite + tsc**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; node --test --import tsx server/lib/health/checks.test.ts && pnpm test && pnpm tsc --noEmit -p tsconfig.json`
Expected: checks tests PASS (incl. 3 new); full suite PASS; tsc clean.

---

## Task 5: Source picker — prefer a source that covers the gap (#2)

**Files:**
- Modify: `server/lib/health/recommend.ts` (`pickSource`)
- Modify: `server/lib/health/recommend.test.ts`

- [ ] **Step 1: Write the failing test**

In `server/lib/health/recommend.test.ts`, add:

```ts
test("pickSource: prefers a source that covers the whole gap over a partial savings", () => {
  const accounts: HealthAccount[] = [
    { id: "a", name: "Current", balance: 0, informational: false },
    { id: "s", name: "Savings", balance: 50, informational: true },   // can't cover 120
    { id: "c", name: "Spending", balance: 300, informational: false }, // covers it
  ];
  const ctx = ctxWith(accounts, {});
  assert.equal(recommendTransfer(ctx, "a", 120), "Move £120.00 from Spending");
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; node --test --import tsx server/lib/health/recommend.test.ts`
Expected: FAIL — current impl returns "Move £50.00 from Savings and top up £70.00".

- [ ] **Step 3: Update `pickSource`**

In `server/lib/health/recommend.ts`, replace the whole `pickSource` function with:
```ts
// The best account to move money FROM to cover a gap on `accountId`. Prefer a
// source that can cover the whole amount in one move; among those (or, if none
// can, among all candidates) prefer savings-ish (informational), then most free cash.
export function pickSource(ctx: HealthContext, accountId: string, amount: number): Source | null {
  const candidates = ctx.accounts
    .filter((a) => a.id !== accountId)
    .map((a) => ({ id: a.id, name: a.name, informational: a.informational, available: freeCash(a, ctx) }))
    .filter((c) => c.available > 0);
  if (!candidates.length) return null;
  const covers = candidates.filter((c) => c.available >= amount);
  const pool = covers.length ? covers : candidates;
  pool.sort((x, y) => (Number(y.informational) - Number(x.informational)) || (y.available - x.available));
  const top = pool[0];
  return { id: top.id, name: top.name, available: top.available };
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; node --test --import tsx server/lib/health/recommend.test.ts`
Expected: PASS (6 tests — the 5 existing still pass, plus the new one).

---

## Task 6: Invalidate the health query after edits (#3)

**Files:**
- Modify: `web/src/components/SettingsDrawer.tsx:22`
- Modify: `web/src/pages/Investments.tsx:22`
- Modify: `web/src/hooks/useTxnEditing.ts:117`
- Modify: `web/src/pages/Dashboard.tsx:66`
- Modify: `web/src/pages/Transactions.tsx:234`
- Modify: `web/src/pages/Debts.tsx:37`
- Modify: `web/src/pages/TransactionReview.tsx:179`

- [ ] **Step 1: Add `["accounts-health"]` invalidation at each site**

At each of the seven locations below, add a sibling `qc.invalidateQueries({ queryKey: ["accounts-health"] });` immediately after the existing `["summary"]` (or `["accounts"]`) invalidation in the same statement/callback:

- `SettingsDrawer.tsx:22` — in the `onSettled` after `["summary"]`.
- `Investments.tsx:22` — after `qc.invalidateQueries({ queryKey: ["summary"] });`.
- `useTxnEditing.ts:117` — in `invalidateAfterDebt`, after the `["summary"]` call.
- `Dashboard.tsx:66` — after `qc.invalidateQueries({ queryKey: ["summary"] });`.
- `Transactions.tsx:234` — in `invalidateAfterDebt`, after the `["summary"]` call.
- `Debts.tsx:37` — in `refresh`, after the `["accounts"]` call.
- `TransactionReview.tsx:179` — after `qc.invalidateQueries({ queryKey: ["summary"] });`.

Each addition is literally:
```ts
qc.invalidateQueries({ queryKey: ["accounts-health"] });
```

- [ ] **Step 2: Verify it compiles + builds**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm tsc --noEmit -p tsconfig.json && pnpm exec vite build`
Expected: tsc clean, build succeeds.

---

## Task 7: "Credit card" toggle in account settings

**Files:**
- Modify: `web/src/api.ts` (`patchAccount`, line 64)
- Modify: `server/routes/accounts.ts` (PATCH handler zod + data, ~207–253)
- Modify: `web/src/pages/Accounts.tsx` (`sForm` ~52, `openSettings` ~54, `saveSettings` ~61–67, the form ~204)

- [ ] **Step 1: Add `creditCard` to the patch client**

In `web/src/api.ts` line 64, add `creditCard?: boolean | null;` to the `patchAccount` patch object type (after `debtExcluded?: boolean`):
```ts
  patchAccount: (id: string, patch: { nickname?: string | null; type?: string; name?: string; manualBalance?: string; excludedBalance?: string | null; informational?: boolean; balanceType?: string | null; interestRate?: string | null; priority?: number | null; targetPayment?: string | null; debtExcluded?: boolean; creditCard?: boolean | null }) =>
```

- [ ] **Step 2: Accept `creditCard` on the server PATCH**

In `server/routes/accounts.ts`, in the PATCH `/accounts/:id` zod schema (the `z.object({...})` ~207–221), add:
```ts
        creditCard: z.boolean().nullable().optional(),
```
And in the data-assembly block (~232–253), add:
```ts
    if (body.creditCard !== undefined) data.creditCard = body.creditCard;
```

- [ ] **Step 3: Add the toggle to the settings form**

In `web/src/pages/Accounts.tsx`:

Extend `sForm` state (line 52) to include `creditCard`:
```ts
  const [sForm, setSForm] = useState({ balanceType: "", informational: false, creditCard: false, excluded: "", balance: "" });
```

In `openSettings` (line 54), seed it from the DTO:
```ts
    setSForm({ balanceType: a.balanceType ?? "", informational: a.informational, creditCard: a.isCreditCard, excluded: a.excludedBalance ? String(a.excludedBalance) : "", balance: String(a.currentBalance) });
```

In `saveSettings`, after the `informational` diff line (line 63), add:
```ts
    if (a.isCreditCard !== sForm.creditCard) patch.creditCard = sForm.creditCard;
```

In the form JSX, immediately after the `informational` `<div className="settings-toggle">…</div>` block (the one ending at line 207), add a BANK-only toggle:
```tsx
            {settingsFor.source === "BANK" && (
              <div className="settings-toggle">
                <Toggle checked={sForm.creditCard} onChange={(v) => setSForm({ ...sForm, creditCard: v })} label="Credit card" />
                <p className="muted settings-hint">In account health, a negative balance is treated as card debt, not an overdraft.</p>
              </div>
            )}
```

- [ ] **Step 4: Verify it compiles + builds**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm tsc --noEmit -p tsconfig.json && pnpm exec vite build`
Expected: tsc clean, build succeeds.

- [ ] **Step 5: Manual check**

With the dev server up: open `/accounts`, open an account's settings, toggle "Credit card" on a bank account, save. Then open `/` and confirm that account's chip no longer shows "Overdrawn"/runway-short in its health panel (cashflow may still show if it's draining). Toggle off restores prior behavior.

---

## Task 8: Best-effort backfill of `cashAccountType`

**Files:**
- Create: `scripts/backfill-account-types.ts`

- [ ] **Step 1: Create the backfill script**

Create `scripts/backfill-account-types.ts`:

```ts
// Best-effort: fetch GoCardless account details for BANK accounts that have no
// cashAccountType yet and store it. PSD2-rate-limited, so it skips accounts already
// typed and tolerates per-account failures. Run:
//   export $(grep -E '^(DATABASE_URL|GOCARDLESS)' .env | xargs) && pnpm tsx scripts/backfill-account-types.ts
import { db } from "../server/lib/db.ts";
import { GoCardlessClient } from "../server/gocardless/client.ts";

async function main() {
  const gc = new GoCardlessClient();
  const accounts = await db.account.findMany({ where: { source: "BANK", cashAccountType: null } });
  console.log(`Backfilling cashAccountType for ${accounts.length} account(s)…`);
  for (const a of accounts) {
    try {
      const type = (await gc.getAccountDetails(a.id)).account?.cashAccountType;
      if (type) {
        await db.account.update({ where: { id: a.id }, data: { cashAccountType: type } });
        console.log(`  ${a.id}: ${type}`);
      } else {
        console.log(`  ${a.id}: (no type returned)`);
      }
    } catch (e) {
      console.log(`  ${a.id}: failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await db.$disconnect();
}

main();
```

- [ ] **Step 2: Verify it type-checks**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm tsc --noEmit -p tsconfig.json`
Expected: no errors. (Do NOT run the script automatically — it consumes the rate-limited GoCardless quota. The user runs it manually when ready; the manual toggle covers existing cards meanwhile.)

---

## Task 9: Final verification + commit (gated on user go-ahead)

**Files:** none

- [ ] **Step 1: Full server suite**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm test`
Expected: all PASS (health + accountKind + everything).

- [ ] **Step 2: Final type + build**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm tsc --noEmit -p tsconfig.json && pnpm exec vite build`
Expected: clean tsc, successful build.

- [ ] **Step 3: Commit — ONLY after the user says to**

This is part of the larger account-health change (still uncommitted). Confirm with the user, then stage this work alongside the rest of the health feature and commit. Push only if asked, over SSH port 443 (`git push ssh://git@ssh.github.com:443/pixeldesignuk/personal-finance.git main`).

---

## Self-Review

**Spec coverage (addendum):**
- Detection auto + manual override (`cashAccountType` + `creditCard` cols, shared `isCreditCard`) → Tasks 1–3. ✓
- Effective helper used by both DTO and health endpoint → Task 2 (toAccountDTO) + Task 4 (endpoint). ✓
- Treatment: cards skip runway + buffer; cashflow card-aware → Task 4. ✓
- Source-picker covers-first refinement (#2) → Task 5. ✓
- Health-query invalidation (#3) → Task 6. ✓
- UI toggle wired through patchAccount → Task 7. ✓
- Backfill script (best-effort, rate-limited) → Task 8. ✓

**Placeholder scan:** none — each step has concrete code/commands and expected output.

**Type consistency:** `isCreditCard(CardLike)` (Task 2) is the single source of truth, called in `toAccountDTO` (Task 2) and the health endpoint (Task 4) with `{ creditCard, cashAccountType }`. `AccountDTO.isCreditCard` (Task 2) is read by `Accounts.tsx` (Task 7). `HealthAccount.isCreditCard?` (Task 4) is read by runway/buffer/cashflow checks (Task 4). `patchAccount`'s `creditCard?: boolean | null` (Task 7 client) matches the server zod `z.boolean().nullable().optional()` (Task 7 server) and the `Account.creditCard Boolean?` column (Task 1). `cashAccountType` is `String?`/`string | null`/`cashAccountType?: string` consistently across schema, DTO input, and GoCardless type.

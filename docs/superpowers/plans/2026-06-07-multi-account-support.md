# Multi-Account Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add UI + endpoints to manage multiple connected banks/accounts: name/nickname accounts, filter all views by account, see a per-account balance breakdown, and add/reconnect/remove banks.

**Architecture:** Additive on the existing relational backend. New `accounts` route (list grouped by bank, patch nickname, delete bank with cascade), an `accountId` filter on the dashboard, a shared `displayName` helper, and a new React "Manage" page + an `AccountSelector` whose selection lives in the URL (`?account=`) and is shared by Dashboard and Transactions.

**Tech Stack:** Existing — Express+TS, Prisma/Postgres, Vite/React, React Router, zod, Node `node:test`, tsx, pnpm.

**Environment note (prefix every node/pnpm/tsx/prisma bash command with):**
`eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)";`

**Git note:** `finance/` is its OWN git repo now (root `/Users/mansoor/Developer/personal/finance`). Commit from there; `git add` explicit paths. End each commit body with:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

**DB note:** No local Postgres is assumed. `prisma generate` works without a DB and is enough for type-checking and tests. Migrations are written as a SQL file by hand (Task 1) and applied later by the human via `prisma migrate deploy` / local run. Do NOT run `prisma migrate dev`.

---

## File Structure

- Modify: `prisma/schema.prisma` (add `Account.nickname`); add `prisma/migrations/20260607230000_add_account_nickname/migration.sql`.
- Create: `shared/displayName.ts` (+ test in `server/lib/displayName.test.ts`).
- Create: `server/lib/accountScope.ts` (+ `server/lib/accountScope.test.ts`).
- Create: `server/routes/accounts.ts`.
- Modify: `server/gocardless/client.ts` (add `deleteRequisition`), `server/routes/dashboard.ts` (account filter), `server/index.ts` (mount accounts route), `shared/types.ts` (new DTOs).
- Create: `web/src/components/AccountSelector.tsx`, `web/src/pages/Accounts.tsx`.
- Modify: `web/src/api.ts`, `web/src/App.tsx`, `web/src/pages/Dashboard.tsx`, `web/src/pages/Transactions.tsx`.

---

## Task 1: Schema — Account.nickname + migration

**Files:** `prisma/schema.prisma` (modify), `prisma/migrations/20260607230000_add_account_nickname/migration.sql` (create)

- [ ] **Step 1: Add the field to `prisma/schema.prisma`**

In `model Account`, add a `nickname` line after `name`:
```prisma
model Account {
  id            String        @id
  requisition   Requisition   @relation(fields: [requisitionId], references: [id])
  requisitionId String
  iban          String?
  name          String?
  nickname      String?
  currency      String?
  ownerName     String?
  createdAt     DateTime      @default(now())
  balances      Balance[]
  transactions  Transaction[]
  syncLogs      SyncLog[]
}
```

- [ ] **Step 2: Create the migration SQL by hand**

Create `prisma/migrations/20260607230000_add_account_nickname/migration.sql`:
```sql
-- AlterTable
ALTER TABLE "Account" ADD COLUMN "nickname" TEXT;
```

- [ ] **Step 3: Regenerate the Prisma client (no DB needed)**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec prisma generate`
Expected: "Generated Prisma Client" — exits 0.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260607230000_add_account_nickname/migration.sql
git commit -m "feat: add Account.nickname column + migration"
```

---

## Task 2: displayName helper (TDD)

**Files:** `shared/displayName.ts` (create), `server/lib/displayName.test.ts` (create)

The test lives under `server/lib/` so the existing `pnpm test` glob (`server/**/*.test.ts`) picks it up; the helper lives in `shared/` so the frontend can import it too.

- [ ] **Step 1: Write the failing test `server/lib/displayName.test.ts`**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { displayName } from "../../shared/displayName.ts";

test("nickname wins when set", () => {
  assert.equal(displayName({ id: "acc-1234", name: "Current", nickname: "Spending" }), "Spending");
});

test("falls back to name when no nickname", () => {
  assert.equal(displayName({ id: "acc-1234", name: "Current", nickname: null }), "Current");
});

test("falls back to id suffix when no name or nickname", () => {
  assert.equal(displayName({ id: "abcd1234", name: null, nickname: null }), "Account ••1234");
});

test("treats empty-string nickname/name as unset", () => {
  assert.equal(displayName({ id: "abcd1234", name: "", nickname: "" }), "Account ••1234");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test server/lib/displayName.test.ts`
Expected: FAIL — cannot find `../../shared/displayName.ts`.

- [ ] **Step 3: Write `shared/displayName.ts`**

```typescript
export interface NameableAccount {
  id: string;
  name?: string | null;
  nickname?: string | null;
}

export function displayName(a: NameableAccount): string {
  if (a.nickname && a.nickname.trim()) return a.nickname;
  if (a.name && a.name.trim()) return a.name;
  return `Account ••${a.id.slice(-4)}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test server/lib/displayName.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/displayName.ts server/lib/displayName.test.ts
git commit -m "feat: add displayName helper"
```

---

## Task 3: accountScope filter helper (TDD)

**Files:** `server/lib/accountScope.ts` (create), `server/lib/accountScope.test.ts` (create)

A tiny pure helper that turns an optional accountId into a Prisma `where` fragment, used by the dashboard for both transactions and balances (DRY + testable).

- [ ] **Step 1: Write the failing test `server/lib/accountScope.test.ts`**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { accountScope } from "./accountScope.ts";

test("returns empty object for undefined (all accounts)", () => {
  assert.deepEqual(accountScope(undefined), {});
});

test("returns empty object for 'all'", () => {
  assert.deepEqual(accountScope("all"), {});
});

test("returns empty object for empty string", () => {
  assert.deepEqual(accountScope(""), {});
});

test("scopes to the given accountId", () => {
  assert.deepEqual(accountScope("acc-1"), { accountId: "acc-1" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test server/lib/accountScope.test.ts`
Expected: FAIL — cannot find `./accountScope.ts`.

- [ ] **Step 3: Write `server/lib/accountScope.ts`**

```typescript
export function accountScope(accountId?: string): { accountId?: string } {
  if (!accountId || accountId === "all") return {};
  return { accountId };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test server/lib/accountScope.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/accountScope.ts server/lib/accountScope.test.ts
git commit -m "feat: add accountScope where-clause helper"
```

---

## Task 4: shared DTOs for accounts

**Files:** `shared/types.ts` (modify — append)

- [ ] **Step 1: Append new DTOs to `shared/types.ts`**

Add at the end of the file:
```typescript
export interface AccountBalanceDTO {
  type: string;
  amount: string;
  currency: string;
}

export interface AccountDTO {
  id: string;
  name: string | null;
  nickname: string | null;
  displayName: string;
  iban: string | null;
  currency: string | null;
  balances: AccountBalanceDTO[];
}

export interface BankDTO {
  requisitionId: string;
  institutionId: string;
  institutionName: string;
  status: string;
  accounts: AccountDTO[];
}

export interface RemoveBankResult {
  deleted: boolean;
  remoteDeleted: boolean;
}

export interface NicknameResult {
  id: string;
  displayName: string;
}
```

- [ ] **Step 2: Verify compile**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add shared/types.ts
git commit -m "feat: add account/bank DTOs"
```

---

## Task 5: GoCardless client — deleteRequisition

**Files:** `server/gocardless/client.ts` (modify)

- [ ] **Step 1: Add a `deleteRequisition` method**

In `server/gocardless/client.ts`, add this method to the `GoCardlessClient` class, right after `getRequisition`:
```typescript
  deleteRequisition(id: string): Promise<unknown> {
    return this.request(`/api/v2/requisitions/${id}/`, { method: "DELETE" });
  }
```

- [ ] **Step 2: Verify compile**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add server/gocardless/client.ts
git commit -m "feat: add deleteRequisition to GoCardless client"
```

---

## Task 6: accounts route (list / nickname / delete)

**Files:** `server/routes/accounts.ts` (create), `server/index.ts` (modify)

- [ ] **Step 1: Write `server/routes/accounts.ts`**

```typescript
import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { GoCardlessClient } from "../gocardless/client.ts";
import { displayName } from "../../shared/displayName.ts";
import type { BankDTO } from "../../shared/types.ts";

export const accountsRouter = Router();
const gc = new GoCardlessClient();

accountsRouter.get("/accounts", async (_req, res, next) => {
  try {
    const reqs = await db.requisition.findMany({
      include: { accounts: { include: { balances: true } } },
      orderBy: { createdAt: "asc" },
    });
    const banks: BankDTO[] = reqs.map((r) => ({
      requisitionId: r.id,
      institutionId: r.institutionId,
      institutionName: r.institutionName,
      status: r.status,
      accounts: r.accounts.map((a) => ({
        id: a.id,
        name: a.name,
        nickname: a.nickname,
        displayName: displayName(a),
        iban: a.iban,
        currency: a.currency,
        balances: a.balances.map((b) => ({
          type: b.type,
          amount: b.amount.toString(),
          currency: b.currency,
        })),
      })),
    }));
    res.json(banks);
  } catch (err) {
    next(err);
  }
});

accountsRouter.patch("/accounts/:id", async (req, res, next) => {
  try {
    const { nickname } = z
      .object({ nickname: z.string().max(60).nullable() })
      .parse(req.body);
    const existing = await db.account.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    const updated = await db.account.update({
      where: { id: req.params.id },
      data: { nickname: nickname && nickname.trim() ? nickname.trim() : null },
    });
    res.json({ id: updated.id, displayName: displayName(updated) });
  } catch (err) {
    next(err);
  }
});

accountsRouter.delete("/banks/:requisitionId", async (req, res, next) => {
  try {
    const id = req.params.requisitionId;
    const reqn = await db.requisition.findUnique({
      where: { id },
      include: { accounts: true },
    });
    if (!reqn) {
      res.status(404).json({ error: "Bank connection not found" });
      return;
    }
    const accountIds = reqn.accounts.map((a) => a.id);

    let remoteDeleted = true;
    try {
      await gc.deleteRequisition(id);
    } catch {
      remoteDeleted = false;
    }

    // Cascade local delete in FK-safe order.
    await db.syncLog.deleteMany({ where: { accountId: { in: accountIds } } });
    await db.transaction.deleteMany({ where: { accountId: { in: accountIds } } });
    await db.balance.deleteMany({ where: { accountId: { in: accountIds } } });
    await db.account.deleteMany({ where: { requisitionId: id } });
    await db.requisition.delete({ where: { id } });

    res.json({ deleted: true, remoteDeleted });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 2: Mount it in `server/index.ts`**

Add the import alongside the other route imports:
```typescript
import { accountsRouter } from "./routes/accounts.ts";
```
And mount it alongside the others (after `dashboardRouter` is mounted):
```typescript
app.use("/api", accountsRouter);
```

- [ ] **Step 3: Verify compile**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec tsc --noEmit`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add server/routes/accounts.ts server/index.ts
git commit -m "feat: add accounts route (list, nickname, remove bank)"
```

---

## Task 7: dashboard account filter

**Files:** `server/routes/dashboard.ts` (modify)

- [ ] **Step 1: Apply the account filter to the dashboard handler**

Replace the entire `dashboardRouter.get("/dashboard", ...)` handler in `server/routes/dashboard.ts` with:
```typescript
dashboardRouter.get("/dashboard", async (req, res, next) => {
  try {
    const { accountId } = z
      .object({ accountId: z.string().optional() })
      .parse(req.query);
    const scope = accountScope(accountId);
    const txns = await db.transaction.findMany({ where: scope });
    const agg: AggTx[] = txns.map((t) => ({
      amount: Number(t.amount),
      category: t.category,
      merchant: t.merchantName ?? t.creditorName ?? t.debtorName ?? null,
      bookingDate: t.bookingDate,
    }));
    const balances = await db.balance.findMany({ where: scope });
    const dto: DashboardDTO = {
      balances: balances.map((b) => ({
        accountId: b.accountId,
        type: b.type,
        amount: b.amount.toString(),
        currency: b.currency,
      })),
      byCategory: spendingByCategory(agg),
      monthly: monthlyTotals(agg),
      topMerchants: topMerchants(agg, 10),
    };
    res.json(dto);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 2: Add the import for `accountScope`**

At the top of `server/routes/dashboard.ts`, add after the existing imports:
```typescript
import { accountScope } from "../lib/accountScope.ts";
```

- [ ] **Step 3: Verify compile**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec tsc --noEmit`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add server/routes/dashboard.ts
git commit -m "feat: filter dashboard by accountId"
```

---

## Task 8: frontend api helpers

**Files:** `web/src/api.ts` (modify — replace whole file)

- [ ] **Step 1: Replace `web/src/api.ts` with this**

```typescript
import type {
  InstitutionDTO, ConnectResponse, FinalizeResponse,
  SyncResult, DashboardDTO, TransactionDTO,
  BankDTO, RemoveBankResult, NicknameResult,
} from "../../shared/types.ts";

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}
async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}

const acctQuery = (accountId?: string) =>
  accountId && accountId !== "all" ? `accountId=${encodeURIComponent(accountId)}` : "";

export const api = {
  institutions: () => get<InstitutionDTO[]>("/api/institutions"),
  connect: (institutionId: string) => send<ConnectResponse>("POST", "/api/connect", { institutionId }),
  finalize: (id: string) => send<FinalizeResponse>("POST", `/api/connect/${id}/finalize`),
  sync: () => send<SyncResult[]>("POST", "/api/sync"),
  accounts: () => get<BankDTO[]>("/api/accounts"),
  setNickname: (id: string, nickname: string | null) =>
    send<NicknameResult>("PATCH", `/api/accounts/${id}`, { nickname }),
  removeBank: (requisitionId: string) =>
    send<RemoveBankResult>("DELETE", `/api/banks/${requisitionId}`),
  dashboard: (accountId?: string) => {
    const q = acctQuery(accountId);
    return get<DashboardDTO>(`/api/dashboard${q ? `?${q}` : ""}`);
  },
  transactions: (search = "", accountId?: string) => {
    const parts = [`search=${encodeURIComponent(search)}`, acctQuery(accountId)].filter(Boolean);
    return get<TransactionDTO[]>(`/api/transactions?${parts.join("&")}`);
  },
};
```

- [ ] **Step 2: Verify build**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec vite build`
Expected: succeeds (no type errors).

- [ ] **Step 3: Commit**

```bash
git add web/src/api.ts
git commit -m "feat: api helpers for accounts, nickname, remove, account filter"
```

---

## Task 9: AccountSelector component

**Files:** `web/src/components/AccountSelector.tsx` (create)

A dropdown that lists "All accounts" + each account by display name, reading/writing the `?account=` URL param. Fetches the account list itself.

- [ ] **Step 1: Write `web/src/components/AccountSelector.tsx`**

```typescript
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.ts";
import type { BankDTO } from "../../../shared/types.ts";

export function AccountSelector() {
  const [banks, setBanks] = useState<BankDTO[]>([]);
  const [params, setParams] = useSearchParams();
  const selected = params.get("account") ?? "all";

  useEffect(() => {
    api.accounts().then(setBanks).catch(() => setBanks([]));
  }, []);

  const onChange = (value: string) => {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete("account");
    else next.set("account", value);
    setParams(next, { replace: true });
  };

  return (
    <select value={selected} onChange={(e) => onChange(e.target.value)}>
      <option value="all">All accounts</option>
      {banks.flatMap((bank) =>
        bank.accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {bank.institutionName} — {a.displayName}
          </option>
        )),
      )}
    </select>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec vite build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/AccountSelector.tsx
git commit -m "feat: AccountSelector bound to ?account= url param"
```

---

## Task 10: Accounts (Manage) page + nav + route

**Files:** `web/src/pages/Accounts.tsx` (create), `web/src/App.tsx` (modify)

- [ ] **Step 1: Write `web/src/pages/Accounts.tsx`**

```typescript
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.ts";
import type { BankDTO } from "../../../shared/types.ts";

export default function Accounts() {
  const [banks, setBanks] = useState<BankDTO[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = () => api.accounts().then(setBanks).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);

  const rename = async (id: string, current: string) => {
    const nickname = window.prompt("Nickname for this account (blank to clear):", current);
    if (nickname === null) return;
    try {
      await api.setNickname(id, nickname.trim() || null);
      await load();
    } catch (e) { setMsg((e as Error).message); }
  };

  const reconnect = async (institutionId: string) => {
    try {
      const { link } = await api.connect(institutionId);
      window.location.href = link;
    } catch (e) { setMsg((e as Error).message); }
  };

  const remove = async (requisitionId: string, name: string) => {
    if (!window.confirm(`Remove ${name}? This deletes its stored transactions and balances.`)) return;
    try {
      const r = await api.removeBank(requisitionId);
      setMsg(r.remoteDeleted ? "Removed." : "Removed locally; bank link may persist at GoCardless.");
      await load();
    } catch (e) { setMsg((e as Error).message); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Manage accounts</h1>
        <button onClick={() => navigate("/connect")}>Add another bank</button>
      </div>
      {msg && <p>{msg}</p>}
      <p style={{ color: "#6b7280", fontSize: 13 }}>
        Reconnecting a bank may add new account entries (the bank issues new IDs); remove the old ones if so.
      </p>
      {banks.length === 0 && <p>No banks connected yet.</p>}
      {banks.map((bank) => (
        <div className="card" key={bank.requisitionId}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>
              {bank.institutionName}{" "}
              <span style={{ fontSize: 12, color: bank.status === "LN" ? "#16a34a" : "#dc2626" }}>
                ({bank.status})
              </span>
            </h3>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => reconnect(bank.institutionId)}>Reconnect</button>
              <button
                style={{ background: "#dc2626" }}
                onClick={() => remove(bank.requisitionId, bank.institutionName)}
              >
                Remove
              </button>
            </div>
          </div>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Account</th><th>Balance</th><th></th></tr></thead>
            <tbody>
              {bank.accounts.map((a) => (
                <tr key={a.id}>
                  <td>{a.displayName}</td>
                  <td>
                    {a.balances.length
                      ? a.balances.map((b) => `${b.currency} ${b.amount}`).join(" / ")
                      : "—"}
                  </td>
                  <td><button onClick={() => rename(a.id, a.nickname ?? "")}>Rename</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add nav link + route in `web/src/App.tsx`**

Replace the whole file with:
```typescript
import { Link, Route, Routes } from "react-router-dom";
import Connect from "./pages/Connect.tsx";
import Callback from "./pages/Callback.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import Transactions from "./pages/Transactions.tsx";
import Accounts from "./pages/Accounts.tsx";

export default function App() {
  return (
    <>
      <nav>
        <Link to="/">Dashboard</Link>
        <Link to="/transactions">Transactions</Link>
        <Link to="/accounts">Manage</Link>
        <Link to="/connect">Connect bank</Link>
      </nav>
      <div className="container">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/connect" element={<Connect />} />
          <Route path="/callback" element={<Callback />} />
        </Routes>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec vite build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Accounts.tsx web/src/App.tsx
git commit -m "feat: Manage accounts page with rename/reconnect/remove"
```

---

## Task 11: Dashboard — selector, filter, per-account breakdown

**Files:** `web/src/pages/Dashboard.tsx` (modify — replace whole file)

- [ ] **Step 1: Replace `web/src/pages/Dashboard.tsx` with this**

```typescript
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.ts";
import type { DashboardDTO, BankDTO } from "../../../shared/types.ts";
import { AccountSelector } from "../components/AccountSelector.tsx";
import { CategoryPie } from "../components/charts/CategoryPie.tsx";
import { MonthlyBar } from "../components/charts/MonthlyBar.tsx";
import { TopMerchants } from "../components/charts/TopMerchants.tsx";

export default function Dashboard() {
  const [params] = useSearchParams();
  const accountId = params.get("account") ?? undefined;
  const [data, setData] = useState<DashboardDTO | null>(null);
  const [banks, setBanks] = useState<BankDTO[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    api.dashboard(accountId).then(setData).catch((e) => setMsg(e.message));
    api.accounts().then(setBanks).catch(() => setBanks([]));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [accountId]);

  const sync = async () => {
    setMsg("Syncing...");
    try {
      const r = await api.sync();
      setMsg(r.map((x) => `${x.accountId.slice(0, 6)}: ${x.skipped ? x.message : `${x.added} txns`}`).join(" · "));
      load();
    } catch (e) { setMsg((e as Error).message); }
  };

  if (!data) return <p>{msg ?? "Loading..."}</p>;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Dashboard</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <AccountSelector />
          <button onClick={sync}>Sync now</button>
        </div>
      </div>
      {msg && <p>{msg}</p>}
      <div className="card">
        <h3>Balances by account</h3>
        {banks.length === 0 && <div>No accounts yet.</div>}
        {banks.map((bank) =>
          bank.accounts
            .filter((a) => !accountId || a.id === accountId)
            .map((a) => (
              <div key={a.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                <span>{bank.institutionName} — {a.displayName}</span>
                <span>{a.balances.map((b) => `${b.currency} ${b.amount}`).join(" / ") || "—"}</span>
              </div>
            )),
        )}
      </div>
      <div className="grid">
        <div className="card"><h3>By category</h3><CategoryPie data={data.byCategory} /></div>
        <div className="card"><h3>Monthly</h3><MonthlyBar data={data.monthly} /></div>
      </div>
      <div className="card"><h3>Top merchants</h3><TopMerchants data={data.topMerchants} /></div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec vite build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Dashboard.tsx
git commit -m "feat: dashboard account selector + per-account balances"
```

---

## Task 12: Transactions — selector + account column

**Files:** `web/src/pages/Transactions.tsx` (modify — replace whole file)

- [ ] **Step 1: Replace `web/src/pages/Transactions.tsx` with this**

```typescript
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.ts";
import type { TransactionDTO, BankDTO } from "../../../shared/types.ts";
import { AccountSelector } from "../components/AccountSelector.tsx";

export default function Transactions() {
  const [params] = useSearchParams();
  const accountId = params.get("account") ?? undefined;
  const [rows, setRows] = useState<TransactionDTO[]>([]);
  const [banks, setBanks] = useState<BankDTO[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => { api.accounts().then(setBanks).catch(() => setBanks([])); }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api.transactions(q, accountId).then(setRows).catch(() => setRows([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, accountId]);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    banks.forEach((bank) => bank.accounts.forEach((a) => m.set(a.id, a.displayName)));
    return m;
  }, [banks]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Transactions</h1>
        <AccountSelector />
      </div>
      <input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card" style={{ marginTop: 16 }}>
        <table>
          <thead><tr><th>Date</th><th>Account</th><th>Name</th><th>Category</th><th>Amount</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.bookingDate ?? ""}</td>
                <td>{nameById.get(r.accountId) ?? r.accountId.slice(-4)}</td>
                <td>{r.name ?? r.remittanceInfo ?? ""}</td>
                <td>{r.category}</td>
                <td style={{ color: Number(r.amount) < 0 ? "#dc2626" : "#16a34a" }}>{r.currency} {r.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec vite build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Transactions.tsx
git commit -m "feat: transactions account selector + account column"
```

---

## Task 13: Full verification

**Files:** none

- [ ] **Step 1: Run all unit tests**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm test`
Expected: PASS — previous 12 + displayName (4) + accountScope (4) = 20 tests.

- [ ] **Step 2: Type check + build**

Run: `pnpm exec tsc --noEmit && pnpm exec vite build`
Expected: both succeed.

---

## Task 14 (MANUAL — human + live account): apply migration + verify

Not for the implementer subagent. Requires Postgres + real account.

- [ ] **Step 1:** Apply the migration — `pnpm exec prisma migrate deploy` (or `prisma migrate dev` locally), which runs `20260607230000_add_account_nickname`.
- [ ] **Step 2:** `pnpm dev`; connect a second bank from the "Manage" page → confirm it appears.
- [ ] **Step 3:** On "Manage", rename an account, confirm the name updates across Dashboard/Transactions.
- [ ] **Step 4:** Use the account selector on Dashboard + Transactions; confirm filtering and per-account balances.
- [ ] **Step 5:** Remove a bank; confirm its data disappears and the confirm dialog fired.

---

## Self-Review

- **Spec coverage:** nickname column (Task 1), displayName (Task 2), per-account filter helper + dashboard filter (Tasks 3/7), DTOs (Task 4), GoCardless delete (Task 5), GET/PATCH/DELETE accounts route with cascade (Task 6), api helpers (Task 8), AccountSelector + URL param (Task 9), Manage page with rename/reconnect/remove (Task 10), dashboard selector + per-account breakdown (Task 11), transactions selector + account column (Task 12). All spec sections mapped.
- **Placeholder scan:** no TBD/TODO; every code step is complete.
- **Type consistency:** `BankDTO`/`AccountDTO`/`AccountBalanceDTO`/`RemoveBankResult`/`NicknameResult` defined in Task 4, consumed identically in routes (Task 6) and `api.ts`/pages (Tasks 8–12). `displayName(NameableAccount)` (Task 2) is called on Prisma `Account` rows (have `id`,`name`,`nickname`) in Task 6 and on `AccountDTO` in the frontend. `accountScope(accountId?)` (Task 3) used in Task 7. `api.setNickname`/`removeBank`/`accounts`/`dashboard(accountId)`/`transactions(search,accountId)` names consistent across Tasks 8–12.
- **Known acceptance:** reconnect-creates-new-rows is surfaced in the UI (Task 10), not auto-deduped (per spec YAGNI).

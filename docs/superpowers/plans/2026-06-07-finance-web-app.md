# Personal Finance Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-service web app (Express API + Vite/React UI + Postgres) that links a UK bank via GoCardless, stores transactions/balances, and shows a spending dashboard, deployed on Railway via Docker.

**Architecture:** One Node package. Express serves `/api/*` and the built React bundle. Prisma/Postgres stores all displayed data; GoCardless is called only on connect and manual sync (4-calls/account/day cap). Pure-logic units (`token`, `categorize`, `aggregate`) are unit-tested with mocked I/O; routes and flows are validated by running against a real account.

**Tech Stack:** Node 20+, TypeScript, Express, Prisma, Postgres, Vite, React, React Router, Recharts, zod, tsx, Node `node:test`. Package manager `pnpm`. Built-in `fetch` for GoCardless.

**Environment note (prefix every node/pnpm/tsx bash command with):**
`eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)";`

**Git note:** branch `finance-gocardless`. Repo root is `/Users/mansoor/Developer/personal` (multi-project; ignore everything outside `finance/`). Stage only explicit `finance/...` paths — never `git add .`. End each commit body with:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

See the design spec (`docs/superpowers/specs/2026-06-07-finance-web-app-design.md`)
for the full tree. Responsibilities: `server/gocardless/*` = API I/O; `server/lib/*`
= pure logic + db; `server/routes/*` = HTTP; `web/*` = UI; `prisma/schema.prisma`
= data model; `shared/types.ts` = DTOs.

---

## Task 1: Scaffold project

**Files:** `package.json`, `tsconfig.json`, `tsconfig.server.json`, `.gitignore`, `.dockerignore`, `.env.example`

- [ ] **Step 1: Init and install deps**

Run:
```bash
eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"
cd /Users/mansoor/Developer/personal/finance
pnpm init
pnpm add express zod @prisma/client
pnpm add -D typescript tsx @types/node @types/express prisma vite @vitejs/plugin-react react react-dom @types/react @types/react-dom react-router-dom recharts concurrently
```

- [ ] **Step 2: Write `tsconfig.json` (base, used by Vite/web)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["web/src", "shared", "server"]
}
```

- [ ] **Step 3: Edit `package.json` — set type/module + scripts**

Merge so the file contains:
```json
{
  "type": "module",
  "scripts": {
    "dev": "concurrently -k -n api,web \"pnpm dev:api\" \"pnpm dev:web\"",
    "dev:api": "tsx watch server/index.ts",
    "dev:web": "vite",
    "build": "prisma generate && vite build",
    "start": "prisma migrate deploy && tsx server/index.ts",
    "db:migrate": "prisma migrate dev",
    "db:studio": "prisma studio",
    "test": "node --import tsx --test server/**/*.test.ts"
  }
}
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
.env
web/dist/
*.log
.DS_Store
```

- [ ] **Step 5: Write `.dockerignore`**

```
node_modules
web/dist
.git
.env
*.log
```

- [ ] **Step 6: Write `.env.example`**

```
GOCARDLESS_SECRET_ID=
GOCARDLESS_SECRET_KEY=
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/finance
APP_BASE_URL=http://localhost:5173
PORT=3000
```

- [ ] **Step 7: Commit**

```bash
cd /Users/mansoor/Developer/personal
git add finance/package.json finance/pnpm-lock.yaml finance/tsconfig.json finance/.gitignore finance/.dockerignore finance/.env.example
git commit -m "chore: scaffold finance web app (express, vite, prisma)"
```

---

## Task 2: Prisma schema + client

**Files:** `prisma/schema.prisma`, `server/lib/db.ts`

- [ ] **Step 1: Init Prisma**

Run:
```bash
eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"
cd /Users/mansoor/Developer/personal/finance
pnpm exec prisma init --datasource-provider postgresql
```
(This creates `prisma/schema.prisma` and appends `DATABASE_URL` to `.env` — keep `.env` gitignored.)

- [ ] **Step 2: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Requisition {
  id              String    @id
  institutionId   String
  institutionName String
  reference       String
  status          String
  createdAt       DateTime  @default(now())
  accounts        Account[]
}

model Account {
  id            String        @id
  requisition   Requisition   @relation(fields: [requisitionId], references: [id])
  requisitionId String
  iban          String?
  name          String?
  currency      String?
  ownerName     String?
  createdAt     DateTime      @default(now())
  balances      Balance[]
  transactions  Transaction[]
  syncLogs      SyncLog[]
}

model Balance {
  id            Int      @id @default(autoincrement())
  account       Account  @relation(fields: [accountId], references: [id])
  accountId     String
  type          String
  amount        Decimal
  currency      String
  referenceDate String?
  fetchedAt     DateTime @default(now())

  @@unique([accountId, type])
}

model Transaction {
  id             String   @id
  account        Account  @relation(fields: [accountId], references: [id])
  accountId      String
  bookingDate    String?
  valueDate      String?
  amount         Decimal
  currency       String
  creditorName   String?
  debtorName     String?
  remittanceInfo String?
  merchantName   String?
  category       String
  status         String
  raw            Json

  @@index([accountId, bookingDate])
}

model SyncLog {
  id        Int      @id @default(autoincrement())
  account   Account  @relation(fields: [accountId], references: [id])
  accountId String
  ranAt     DateTime @default(now())
  added     Int
  status    String
}
```

- [ ] **Step 3: Write `server/lib/db.ts`**

```typescript
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const db = global.__prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") global.__prisma = db;
```

- [ ] **Step 4: Generate client + create the initial migration**

Run (requires a reachable Postgres in `DATABASE_URL`; if none locally, see note):
```bash
eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"
cd /Users/mansoor/Developer/personal/finance
pnpm exec prisma generate
```
Note: if no local Postgres is available to the implementer, run `prisma generate` only (it does not need a DB) and DEFER `prisma migrate dev` to the manual run task (Task 12). Report this as a concern, do not block.

- [ ] **Step 5: Commit**

```bash
cd /Users/mansoor/Developer/personal
git add finance/prisma/schema.prisma finance/server/lib/db.ts
git commit -m "feat: add Prisma schema and client"
```

---

## Task 3: Env validation + shared types

**Files:** `server/env.ts`, `shared/types.ts`

- [ ] **Step 1: Write `server/env.ts`**

```typescript
import { z } from "zod";

const schema = z.object({
  GOCARDLESS_SECRET_ID: z.string().min(1),
  GOCARDLESS_SECRET_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  APP_BASE_URL: z.string().url(),
  PORT: z.string().default("3000"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
  throw new Error(
    `Invalid/missing environment variables: ${missing}. ` +
      `Copy .env.example to .env and fill them in.`,
  );
}

export const env = parsed.data;
```

- [ ] **Step 2: Write `shared/types.ts`**

```typescript
export interface InstitutionDTO {
  id: string;
  name: string;
  bic?: string;
}

export interface ConnectResponse {
  id: string;
  link: string;
}

export interface FinalizeResponse {
  accounts: number;
}

export interface SyncResult {
  accountId: string;
  added: number;
  skipped: boolean;
  message?: string;
}

export interface BalanceDTO {
  accountId: string;
  type: string;
  amount: string;
  currency: string;
}

export interface CategoryTotal {
  category: string;
  total: number;
}

export interface MonthlyTotal {
  month: string; // YYYY-MM
  spent: number;
  received: number;
}

export interface MerchantTotal {
  merchant: string;
  total: number;
  count: number;
}

export interface DashboardDTO {
  balances: BalanceDTO[];
  byCategory: CategoryTotal[];
  monthly: MonthlyTotal[];
  topMerchants: MerchantTotal[];
}

export interface TransactionDTO {
  id: string;
  accountId: string;
  bookingDate: string | null;
  amount: string;
  currency: string;
  name: string | null; // creditor/debtor/merchant best-effort
  remittanceInfo: string | null;
  category: string;
  status: string;
}
```

- [ ] **Step 3: Verify compile**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec tsc --noEmit`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/mansoor/Developer/personal
git add finance/server/env.ts finance/shared/types.ts
git commit -m "feat: add env validation and shared DTO types"
```

---

## Task 4: GoCardless types + token (TDD)

**Files:** `server/gocardless/types.ts`, `server/gocardless/token.ts`, `server/gocardless/token.test.ts`

- [ ] **Step 1: Write `server/gocardless/types.ts`**

```typescript
export interface TokenResponse {
  access: string;
  access_expires: number; // seconds
  refresh: string;
  refresh_expires: number;
}

export interface GcInstitution {
  id: string;
  name: string;
  bic?: string;
}

export interface GcRequisition {
  id: string;
  status: string; // "CR" | "LN" | ...
  link: string;
  accounts: string[];
  institution_id: string;
  reference: string;
}

export interface GcAccountDetails {
  account?: {
    iban?: string;
    name?: string;
    currency?: string;
    ownerName?: string;
  };
}

export interface GcBalance {
  balanceAmount: { amount: string; currency: string };
  balanceType: string;
  referenceDate?: string;
}

export interface GcBalances {
  balances: GcBalance[];
}

export interface GcTransaction {
  transactionId?: string;
  internalTransactionId?: string;
  bookingDate?: string;
  valueDate?: string;
  transactionAmount: { amount: string; currency: string };
  creditorName?: string;
  debtorName?: string;
  remittanceInformationUnstructured?: string;
  merchantName?: string;
  [k: string]: unknown;
}

export interface GcTransactions {
  transactions: { booked: GcTransaction[]; pending: GcTransaction[] };
}
```

- [ ] **Step 2: Write the failing test `server/gocardless/token.test.ts`**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { TokenManager } from "./token.ts";

const creds = { secretId: "id", secretKey: "key" };

test("fetches once then serves cached token", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return new Response(JSON.stringify({ access: "tok-A", access_expires: 3600 }), { status: 200 });
  }) as typeof fetch;
  const tm = new TokenManager(creds, fetchImpl, () => 1000);
  assert.equal(await tm.get(), "tok-A");
  assert.equal(await tm.get(), "tok-A");
  assert.equal(calls, 1);
});

test("re-fetches after expiry", async () => {
  let token = "tok-1";
  const fetchImpl = (async () => {
    const body = { access: token, access_expires: 100 };
    token = "tok-2";
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  let now = 0;
  const tm = new TokenManager(creds, fetchImpl, () => now);
  assert.equal(await tm.get(), "tok-1");
  now = 200_000; // past 100s expiry (ms)
  assert.equal(await tm.get(), "tok-2");
});

test("throws on non-2xx", async () => {
  const fetchImpl = (async () => new Response("nope", { status: 401 })) as typeof fetch;
  const tm = new TokenManager(creds, fetchImpl, () => 0);
  await assert.rejects(() => tm.get(), /401/);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; node --import tsx --test server/gocardless/token.test.ts`
Expected: FAIL — cannot find `./token.ts`.

- [ ] **Step 4: Write `server/gocardless/token.ts`**

```typescript
import type { TokenResponse } from "./types.ts";

const BASE = "https://bankaccountdata.gocardless.com";
const SKEW_MS = 60_000;

export interface Creds {
  secretId: string;
  secretKey: string;
}

export class TokenManager {
  private access: string | null = null;
  private expiresAt = 0;

  constructor(
    private creds: Creds,
    private fetchImpl: typeof fetch = fetch,
    private now: () => number = Date.now,
  ) {}

  async get(): Promise<string> {
    if (this.access && this.expiresAt - SKEW_MS > this.now()) return this.access;
    const res = await this.fetchImpl(`${BASE}/api/v2/token/new/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ secret_id: this.creds.secretId, secret_key: this.creds.secretKey }),
    });
    if (!res.ok) throw new Error(`Token request failed (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as TokenResponse;
    this.access = body.access;
    this.expiresAt = this.now() + body.access_expires * 1000;
    return this.access;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --import tsx --test server/gocardless/token.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/mansoor/Developer/personal
git add finance/server/gocardless/types.ts finance/server/gocardless/token.ts finance/server/gocardless/token.test.ts
git commit -m "feat: add GoCardless token manager with cache"
```

---

## Task 5: GoCardless client

**Files:** `server/gocardless/client.ts`

- [ ] **Step 1: Write `server/gocardless/client.ts`**

```typescript
import { env } from "../env.ts";
import { TokenManager, type Creds } from "./token.ts";
import type {
  GcAccountDetails,
  GcBalances,
  GcInstitution,
  GcRequisition,
  GcTransactions,
} from "./types.ts";

const BASE = "https://bankaccountdata.gocardless.com";

export class GoCardlessError extends Error {
  constructor(public status: number, public body: string, public retryAfter?: string) {
    super(`GoCardless API error ${status}: ${body}`);
  }
}

export class GoCardlessClient {
  private tokens: TokenManager;
  constructor(creds: Creds = { secretId: env.GOCARDLESS_SECRET_ID, secretKey: env.GOCARDLESS_SECRET_KEY }) {
    this.tokens = new TokenManager(creds);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.tokens.get();
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new GoCardlessError(res.status, await res.text(), res.headers.get("Retry-After") ?? undefined);
    }
    return (await res.json()) as T;
  }

  getInstitutions(country: string): Promise<GcInstitution[]> {
    return this.request(`/api/v2/institutions/?country=${country}`);
  }

  createRequisition(institutionId: string, reference: string, redirect: string): Promise<GcRequisition> {
    return this.request("/api/v2/requisitions/", {
      method: "POST",
      body: JSON.stringify({ institution_id: institutionId, reference, redirect }),
    });
  }

  getRequisition(id: string): Promise<GcRequisition> {
    return this.request(`/api/v2/requisitions/${id}/`);
  }

  getAccountDetails(id: string): Promise<GcAccountDetails> {
    return this.request(`/api/v2/accounts/${id}/details/`);
  }

  getBalances(id: string): Promise<GcBalances> {
    return this.request(`/api/v2/accounts/${id}/balances/`);
  }

  getTransactions(id: string): Promise<GcTransactions> {
    return this.request(`/api/v2/accounts/${id}/transactions/`);
  }
}
```

- [ ] **Step 2: Verify compile**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/mansoor/Developer/personal
git add finance/server/gocardless/client.ts
git commit -m "feat: add typed GoCardless API client"
```

---

## Task 6: Categorize (TDD)

**Files:** `server/lib/categorize.ts`, `server/lib/categorize.test.ts`

- [ ] **Step 1: Write failing test `server/lib/categorize.test.ts`**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { categorize } from "./categorize.ts";

test("positive amount with salary term is income", () => {
  assert.equal(categorize({ amount: 2500, text: "ACME LTD SALARY" }), "income");
});

test("groceries by merchant keyword", () => {
  assert.equal(categorize({ amount: -42.1, text: "TESCO STORES 1234" }), "groceries");
});

test("eating-out keyword", () => {
  assert.equal(categorize({ amount: -12, text: "PRET A MANGER" }), "eating-out");
});

test("transport keyword", () => {
  assert.equal(categorize({ amount: -3.5, text: "TFL TRAVEL CH" }), "transport");
});

test("bills keyword", () => {
  assert.equal(categorize({ amount: -60, text: "BRITISH GAS" }), "bills");
});

test("unknown debit falls back to other", () => {
  assert.equal(categorize({ amount: -9.99, text: "ZZZ UNKNOWN MERCH" }), "other");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --import tsx --test server/lib/categorize.test.ts`
Expected: FAIL — cannot find `./categorize.ts`.

- [ ] **Step 3: Write `server/lib/categorize.ts`**

```typescript
export type Category =
  | "income"
  | "groceries"
  | "eating-out"
  | "transport"
  | "bills"
  | "shopping"
  | "other";

export interface CategorizeInput {
  amount: number;
  text: string; // merchant/creditor/remittance combined
}

const RULES: { category: Category; keywords: string[] }[] = [
  { category: "groceries", keywords: ["tesco", "sainsbury", "asda", "aldi", "lidl", "morrison", "waitrose", "co-op", "iceland"] },
  { category: "eating-out", keywords: ["pret", "greggs", "mcdonald", "kfc", "nando", "costa", "starbucks", "deliveroo", "uber eats", "just eat", "restaurant", "cafe"] },
  { category: "transport", keywords: ["tfl", "uber", "trainline", "national rail", "bp ", "shell", "esso", "petrol", "parking"] },
  { category: "bills", keywords: ["british gas", "edf", "octopus energy", "thames water", "council tax", "vodafone", "ee ", "o2", "three", "sky", "virgin media", "netflix", "spotify", "insurance"] },
  { category: "shopping", keywords: ["amazon", "argos", "ikea", "asos", "ebay", "currys", "john lewis", "next ", "primark"] },
];

const INCOME_TERMS = ["salary", "payroll", "wages", "hmrc", "refund"];

export function categorize(tx: CategorizeInput): Category {
  const text = tx.text.toLowerCase();
  if (tx.amount > 0) {
    if (INCOME_TERMS.some((t) => text.includes(t))) return "income";
    return "income"; // any credit treated as income in v1
  }
  for (const rule of RULES) {
    if (rule.keywords.some((k) => text.includes(k))) return rule.category;
  }
  return "other";
}
```

Note: in v1 every positive amount is `income` (the salary-term branch documents intent and is covered by the test). Debits match the ordered rule list; first match wins.

- [ ] **Step 4: Run to verify pass**

Run: `node --import tsx --test server/lib/categorize.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/mansoor/Developer/personal
git add finance/server/lib/categorize.ts finance/server/lib/categorize.test.ts
git commit -m "feat: add rules-based transaction categorizer"
```

---

## Task 7: Aggregate (TDD)

**Files:** `server/lib/aggregate.ts`, `server/lib/aggregate.test.ts`

- [ ] **Step 1: Write failing test `server/lib/aggregate.test.ts`**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { spendingByCategory, monthlyTotals, topMerchants, type AggTx } from "./aggregate.ts";

const txns: AggTx[] = [
  { amount: -10, category: "groceries", merchant: "Tesco", bookingDate: "2026-05-02" },
  { amount: -20, category: "groceries", merchant: "Tesco", bookingDate: "2026-05-10" },
  { amount: -5, category: "transport", merchant: "TfL", bookingDate: "2026-05-11" },
  { amount: 2500, category: "income", merchant: "Acme", bookingDate: "2026-05-01" },
  { amount: -30, category: "groceries", merchant: "Aldi", bookingDate: "2026-06-01" },
];

test("spendingByCategory sums debits only, descending", () => {
  const r = spendingByCategory(txns);
  assert.deepEqual(r[0], { category: "groceries", total: 60 });
  assert.deepEqual(r[1], { category: "transport", total: 5 });
  assert.ok(!r.some((c) => c.category === "income"));
});

test("monthlyTotals groups by month", () => {
  const r = monthlyTotals(txns);
  const may = r.find((m) => m.month === "2026-05")!;
  assert.equal(may.spent, 35);
  assert.equal(may.received, 2500);
  const jun = r.find((m) => m.month === "2026-06")!;
  assert.equal(jun.spent, 30);
});

test("topMerchants ranks debit spend", () => {
  const r = topMerchants(txns, 2);
  assert.deepEqual(r[0], { merchant: "Tesco", total: 30, count: 2 });
  assert.equal(r.length, 2);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --import tsx --test server/lib/aggregate.test.ts`
Expected: FAIL — cannot find `./aggregate.ts`.

- [ ] **Step 3: Write `server/lib/aggregate.ts`**

```typescript
import type { CategoryTotal, MerchantTotal, MonthlyTotal } from "../../shared/types.ts";

export interface AggTx {
  amount: number;
  category: string;
  merchant: string | null;
  bookingDate: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function spendingByCategory(txns: AggTx[]): CategoryTotal[] {
  const map = new Map<string, number>();
  for (const t of txns) {
    if (t.amount >= 0) continue;
    map.set(t.category, (map.get(t.category) ?? 0) + -t.amount);
  }
  return [...map.entries()]
    .map(([category, total]) => ({ category, total: round2(total) }))
    .sort((a, b) => b.total - a.total);
}

export function monthlyTotals(txns: AggTx[]): MonthlyTotal[] {
  const map = new Map<string, { spent: number; received: number }>();
  for (const t of txns) {
    if (!t.bookingDate) continue;
    const month = t.bookingDate.slice(0, 7);
    const e = map.get(month) ?? { spent: 0, received: 0 };
    if (t.amount < 0) e.spent += -t.amount;
    else e.received += t.amount;
    map.set(month, e);
  }
  return [...map.entries()]
    .map(([month, v]) => ({ month, spent: round2(v.spent), received: round2(v.received) }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function topMerchants(txns: AggTx[], n: number): MerchantTotal[] {
  const map = new Map<string, { total: number; count: number }>();
  for (const t of txns) {
    if (t.amount >= 0 || !t.merchant) continue;
    const e = map.get(t.merchant) ?? { total: 0, count: 0 };
    e.total += -t.amount;
    e.count += 1;
    map.set(t.merchant, e);
  }
  return [...map.entries()]
    .map(([merchant, v]) => ({ merchant, total: round2(v.total), count: v.count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, n);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --import tsx --test server/lib/aggregate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/mansoor/Developer/personal
git add finance/server/lib/aggregate.ts finance/server/lib/aggregate.test.ts
git commit -m "feat: add dashboard aggregation functions"
```

---

## Task 8: API routes

**Files:** `server/routes/institutions.ts`, `server/routes/connect.ts`, `server/routes/sync.ts`, `server/routes/dashboard.ts`

These are I/O glue; no unit tests (validated by the live run). Each exports an Express `Router`.

- [ ] **Step 1: Write `server/routes/institutions.ts`**

```typescript
import { Router } from "express";
import { GoCardlessClient } from "../gocardless/client.ts";
import type { InstitutionDTO } from "../../shared/types.ts";

export const institutionsRouter = Router();
const gc = new GoCardlessClient();

institutionsRouter.get("/institutions", async (_req, res, next) => {
  try {
    const list = await gc.getInstitutions("gb");
    const dto: InstitutionDTO[] = list.map((i) => ({ id: i.id, name: i.name, bic: i.bic }));
    res.json(dto);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 2: Write `server/routes/connect.ts`**

```typescript
import { Router } from "express";
import { z } from "zod";
import { env } from "../env.ts";
import { db } from "../lib/db.ts";
import { GoCardlessClient } from "../gocardless/client.ts";
import { syncAccount } from "./sync.ts";

export const connectRouter = Router();
const gc = new GoCardlessClient();

connectRouter.post("/connect", async (req, res, next) => {
  try {
    const { institutionId } = z.object({ institutionId: z.string().min(1) }).parse(req.body);
    const institutions = await gc.getInstitutions("gb");
    const inst = institutions.find((i) => i.id === institutionId);
    const reference = `finance-${institutionId}-${Date.now()}`;
    const requisition = await gc.createRequisition(
      institutionId,
      reference,
      `${env.APP_BASE_URL}/callback`,
    );
    await db.requisition.create({
      data: {
        id: requisition.id,
        institutionId,
        institutionName: inst?.name ?? institutionId,
        reference,
        status: requisition.status,
      },
    });
    res.json({ id: requisition.id, link: requisition.link });
  } catch (err) {
    next(err);
  }
});

connectRouter.post("/connect/:id/finalize", async (req, res, next) => {
  try {
    const id = req.params.id;
    const requisition = await gc.getRequisition(id);
    await db.requisition.update({ where: { id }, data: { status: requisition.status } });
    if (requisition.status !== "LN") {
      res.status(409).json({ status: requisition.status, message: "Bank link not completed yet." });
      return;
    }
    for (const accountId of requisition.accounts) {
      const details = await gc.getAccountDetails(accountId);
      await db.account.upsert({
        where: { id: accountId },
        create: {
          id: accountId,
          requisitionId: id,
          iban: details.account?.iban,
          name: details.account?.name,
          currency: details.account?.currency,
          ownerName: details.account?.ownerName,
        },
        update: {
          iban: details.account?.iban,
          name: details.account?.name,
          currency: details.account?.currency,
          ownerName: details.account?.ownerName,
        },
      });
      await syncAccount(accountId);
    }
    res.json({ accounts: requisition.accounts.length });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 3: Write `server/routes/sync.ts`**

```typescript
import { Router } from "express";
import { db } from "../lib/db.ts";
import { GoCardlessClient, GoCardlessError } from "../gocardless/client.ts";
import { categorize } from "../lib/categorize.ts";
import type { SyncResult } from "../../shared/types.ts";

export const syncRouter = Router();
const gc = new GoCardlessClient();

const SYNC_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export async function syncAccount(accountId: string): Promise<SyncResult> {
  const last = await db.syncLog.findFirst({
    where: { accountId, status: "ok" },
    orderBy: { ranAt: "desc" },
  });
  if (last && Date.now() - last.ranAt.getTime() < SYNC_COOLDOWN_MS) {
    return { accountId, added: 0, skipped: true, message: "Synced recently; try later (rate limit)." };
  }

  const balances = await gc.getBalances(accountId);
  for (const b of balances.balances) {
    await db.balance.upsert({
      where: { accountId_type: { accountId, type: b.balanceType } },
      create: {
        accountId,
        type: b.balanceType,
        amount: b.balanceAmount.amount,
        currency: b.balanceAmount.currency,
        referenceDate: b.referenceDate,
      },
      update: {
        amount: b.balanceAmount.amount,
        currency: b.balanceAmount.currency,
        referenceDate: b.referenceDate,
        fetchedAt: new Date(),
      },
    });
  }

  const txns = await gc.getTransactions(accountId);
  const rows = [
    ...txns.transactions.booked.map((t) => ({ t, status: "booked" })),
    ...txns.transactions.pending.map((t) => ({ t, status: "pending" })),
  ];
  let added = 0;
  for (const { t, status } of rows) {
    const id = t.transactionId ?? t.internalTransactionId;
    if (!id) continue;
    const amount = Number(t.transactionAmount.amount);
    const text = [t.merchantName, t.creditorName, t.debtorName, t.remittanceInformationUnstructured]
      .filter(Boolean)
      .join(" ");
    const category = categorize({ amount, text });
    const result = await db.transaction.upsert({
      where: { id },
      create: {
        id,
        accountId,
        bookingDate: t.bookingDate,
        valueDate: t.valueDate,
        amount: t.transactionAmount.amount,
        currency: t.transactionAmount.currency,
        creditorName: t.creditorName,
        debtorName: t.debtorName,
        remittanceInfo: t.remittanceInformationUnstructured,
        merchantName: t.merchantName,
        category,
        status,
        raw: t as object,
      },
      update: { category, status },
    });
    if (result) added += 1; // upsert always returns a row; counts processed
  }

  await db.syncLog.create({ data: { accountId, added, status: "ok" } });
  return { accountId, added, skipped: false };
}

syncRouter.post("/sync", async (_req, res, next) => {
  try {
    const accounts = await db.account.findMany();
    const results: SyncResult[] = [];
    for (const a of accounts) {
      try {
        results.push(await syncAccount(a.id));
      } catch (err) {
        if (err instanceof GoCardlessError && err.status === 429) {
          results.push({
            accountId: a.id,
            added: 0,
            skipped: true,
            message: `Rate limited. Retry after: ${err.retryAfter ?? "unknown"}.`,
          });
          continue;
        }
        throw err;
      }
    }
    res.json(results);
  } catch (err) {
    next(err);
  }
});
```

Note: `added` counts processed rows (upsert can't cheaply distinguish insert vs update); acceptable for v1 display.

- [ ] **Step 4: Write `server/routes/dashboard.ts`**

```typescript
import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { spendingByCategory, monthlyTotals, topMerchants, type AggTx } from "../lib/aggregate.ts";
import type { DashboardDTO, TransactionDTO } from "../../shared/types.ts";

export const dashboardRouter = Router();

dashboardRouter.get("/dashboard", async (_req, res, next) => {
  try {
    const txns = await db.transaction.findMany();
    const agg: AggTx[] = txns.map((t) => ({
      amount: Number(t.amount),
      category: t.category,
      merchant: t.merchantName ?? t.creditorName ?? t.debtorName ?? null,
      bookingDate: t.bookingDate,
    }));
    const balances = await db.balance.findMany();
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

dashboardRouter.get("/transactions", async (req, res, next) => {
  try {
    const q = z
      .object({ search: z.string().optional(), accountId: z.string().optional(), limit: z.coerce.number().max(500).default(200) })
      .parse(req.query);
    const txns = await db.transaction.findMany({
      where: {
        accountId: q.accountId,
        ...(q.search
          ? {
              OR: [
                { merchantName: { contains: q.search, mode: "insensitive" } },
                { creditorName: { contains: q.search, mode: "insensitive" } },
                { remittanceInfo: { contains: q.search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { bookingDate: "desc" },
      take: q.limit,
    });
    const dto: TransactionDTO[] = txns.map((t) => ({
      id: t.id,
      accountId: t.accountId,
      bookingDate: t.bookingDate,
      amount: t.amount.toString(),
      currency: t.currency,
      name: t.merchantName ?? t.creditorName ?? t.debtorName ?? null,
      remittanceInfo: t.remittanceInfo,
      category: t.category,
      status: t.status,
    }));
    res.json(dto);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 5: Verify compile**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec tsc --noEmit`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
cd /Users/mansoor/Developer/personal
git add finance/server/routes
git commit -m "feat: add institutions, connect, sync, dashboard routes"
```

---

## Task 9: Express server entry

**Files:** `server/index.ts`

- [ ] **Step 1: Write `server/index.ts`**

```typescript
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { env } from "./env.ts";
import { institutionsRouter } from "./routes/institutions.ts";
import { connectRouter } from "./routes/connect.ts";
import { syncRouter } from "./routes/sync.ts";
import { dashboardRouter } from "./routes/dashboard.ts";

const app = express();
app.use(express.json());

app.use("/api", institutionsRouter);
app.use("/api", connectRouter);
app.use("/api", syncRouter);
app.use("/api", dashboardRouter);

// Serve built frontend in production.
const __dirname = dirname(fileURLToPath(import.meta.url));
const webDist = join(__dirname, "..", "web", "dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("*", (_req, res) => res.sendFile(join(webDist, "index.html")));
}

// Error handler.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : "Internal error";
  console.error(err);
  res.status(500).json({ error: message });
});

app.listen(Number(env.PORT), () => {
  console.log(`Finance app listening on :${env.PORT}`);
});
```

- [ ] **Step 2: Verify compile**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/mansoor/Developer/personal
git add finance/server/index.ts
git commit -m "feat: add express server entry serving api + static web"
```

---

## Task 10: Frontend (Vite + React)

**Files:** `web/index.html`, `vite.config.ts`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/api.ts`, `web/src/pages/{Connect,Callback,Dashboard,Transactions}.tsx`, `web/src/components/charts/{CategoryPie,MonthlyBar,TopMerchants}.tsx`, `web/src/styles.css`

- [ ] **Step 1: Write `vite.config.ts`**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "web",
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
```

- [ ] **Step 2: Write `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Finance</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Write `web/src/styles.css`**

```css
:root { font-family: system-ui, sans-serif; color: #1a1a1a; }
body { margin: 0; background: #f6f7f9; }
.container { max-width: 1000px; margin: 0 auto; padding: 24px; }
nav { display: flex; gap: 16px; padding: 16px 24px; background: #fff; border-bottom: 1px solid #e5e7eb; }
nav a { text-decoration: none; color: #374151; font-weight: 500; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
button { padding: 8px 14px; border-radius: 8px; border: 1px solid #d1d5db; background: #111827; color: #fff; cursor: pointer; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px; border-bottom: 1px solid #eee; font-size: 14px; }
input { padding: 8px; border: 1px solid #d1d5db; border-radius: 8px; width: 100%; box-sizing: border-box; }
```

- [ ] **Step 4: Write `web/src/api.ts`**

```typescript
import type {
  InstitutionDTO, ConnectResponse, FinalizeResponse,
  SyncResult, DashboardDTO, TransactionDTO,
} from "../../shared/types.ts";

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}
async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}

export const api = {
  institutions: () => get<InstitutionDTO[]>("/api/institutions"),
  connect: (institutionId: string) => post<ConnectResponse>("/api/connect", { institutionId }),
  finalize: (id: string) => post<FinalizeResponse>(`/api/connect/${id}/finalize`),
  sync: () => post<SyncResult[]>("/api/sync"),
  dashboard: () => get<DashboardDTO>("/api/dashboard"),
  transactions: (search = "") => get<TransactionDTO[]>(`/api/transactions?search=${encodeURIComponent(search)}`),
};
```

- [ ] **Step 5: Write `web/src/main.tsx`**

```typescript
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
```

- [ ] **Step 6: Write `web/src/App.tsx`**

```typescript
import { Link, Route, Routes } from "react-router-dom";
import Connect from "./pages/Connect.tsx";
import Callback from "./pages/Callback.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import Transactions from "./pages/Transactions.tsx";

export default function App() {
  return (
    <>
      <nav>
        <Link to="/">Dashboard</Link>
        <Link to="/transactions">Transactions</Link>
        <Link to="/connect">Connect bank</Link>
      </nav>
      <div className="container">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/connect" element={<Connect />} />
          <Route path="/callback" element={<Callback />} />
        </Routes>
      </div>
    </>
  );
}
```

- [ ] **Step 7: Write `web/src/pages/Connect.tsx`**

```typescript
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { InstitutionDTO } from "../../../shared/types.ts";

export default function Connect() {
  const [list, setList] = useState<InstitutionDTO[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.institutions().then(setList).catch((e) => setError(e.message));
  }, []);

  const choose = async (id: string) => {
    try {
      const { link } = await api.connect(id);
      window.location.href = link;
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const filtered = list.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <h1>Connect a bank</h1>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <input placeholder="Search banks..." value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card" style={{ marginTop: 16 }}>
        {filtered.map((i) => (
          <div key={i.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
            <span>{i.name}</span>
            <button onClick={() => choose(i.id)}>Connect</button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Write `web/src/pages/Callback.tsx`**

```typescript
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.ts";

export default function Callback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState("Finalising connection...");

  useEffect(() => {
    // GoCardless appends ?ref=<reference>; we stored requisition id by reference is not
    // available client-side, so the id is passed via the same ref we set = requisition reference.
    // The finalize endpoint accepts the requisition id; we look it up via the ref param.
    const id = params.get("id") ?? params.get("ref");
    if (!id) { setStatus("Missing requisition reference."); return; }
    api.finalize(id)
      .then((r) => { setStatus(`Connected ${r.accounts} account(s).`); setTimeout(() => navigate("/"), 1200); })
      .catch((e) => setStatus(`Error: ${e.message}`));
  }, [params, navigate]);

  return <div><h1>Bank connection</h1><p>{status}</p></div>;
}
```

Note: see Task 11 — `connect` must persist a mapping so `/callback` can resolve the requisition id from the `ref`. We pass the requisition **id** directly by setting the redirect to include it (handled in Task 11 fix).

- [ ] **Step 9: Write chart components**

`web/src/components/charts/CategoryPie.tsx`:
```typescript
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import type { CategoryTotal } from "../../../../shared/types.ts";

const COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#6b7280"];

export function CategoryPie({ data }: { data: CategoryTotal[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey="total" nameKey="category" outerRadius={90} label>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}
```

`web/src/components/charts/MonthlyBar.tsx`:
```typescript
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { MonthlyTotal } from "../../../../shared/types.ts";

export function MonthlyBar({ data }: { data: MonthlyTotal[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data}>
        <XAxis dataKey="month" /><YAxis /><Tooltip /><Legend />
        <Bar dataKey="spent" fill="#dc2626" />
        <Bar dataKey="received" fill="#16a34a" />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

`web/src/components/charts/TopMerchants.tsx`:
```typescript
import type { MerchantTotal } from "../../../../shared/types.ts";

export function TopMerchants({ data }: { data: MerchantTotal[] }) {
  return (
    <table>
      <thead><tr><th>Merchant</th><th>Spent</th><th>#</th></tr></thead>
      <tbody>
        {data.map((m) => (
          <tr key={m.merchant}><td>{m.merchant}</td><td>£{m.total.toFixed(2)}</td><td>{m.count}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 10: Write `web/src/pages/Dashboard.tsx`**

```typescript
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { DashboardDTO } from "../../../shared/types.ts";
import { CategoryPie } from "../components/charts/CategoryPie.tsx";
import { MonthlyBar } from "../components/charts/MonthlyBar.tsx";
import { TopMerchants } from "../components/charts/TopMerchants.tsx";

export default function Dashboard() {
  const [data, setData] = useState<DashboardDTO | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api.dashboard().then(setData).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);

  const sync = async () => {
    setMsg("Syncing...");
    try {
      const r = await api.sync();
      setMsg(r.map((x) => `${x.accountId.slice(0, 6)}: ${x.skipped ? x.message : `${x.added} txns`}`).join(" · "));
      await load();
    } catch (e) { setMsg((e as Error).message); }
  };

  if (!data) return <p>{msg ?? "Loading..."}</p>;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Dashboard</h1>
        <button onClick={sync}>Sync now</button>
      </div>
      {msg && <p>{msg}</p>}
      <div className="card">
        <h3>Balances</h3>
        {data.balances.map((b) => (
          <div key={b.accountId + b.type}>{b.type}: {b.currency} {b.amount}</div>
        ))}
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

- [ ] **Step 11: Write `web/src/pages/Transactions.tsx`**

```typescript
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { TransactionDTO } from "../../../shared/types.ts";

export default function Transactions() {
  const [rows, setRows] = useState<TransactionDTO[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    const t = setTimeout(() => { api.transactions(q).then(setRows).catch(() => setRows([])); }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div>
      <h1>Transactions</h1>
      <input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card" style={{ marginTop: 16 }}>
        <table>
          <thead><tr><th>Date</th><th>Name</th><th>Category</th><th>Amount</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.bookingDate ?? ""}</td>
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

- [ ] **Step 12: Verify build**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec vite build`
Expected: builds `web/dist` with no type errors.

- [ ] **Step 13: Commit**

```bash
cd /Users/mansoor/Developer/personal
git add finance/web finance/vite.config.ts
git commit -m "feat: add React frontend (connect, dashboard, transactions)"
```

---

## Task 11: Fix the callback requisition-id round-trip

**Problem:** GoCardless redirects to the `redirect` URL and appends `?ref=<reference>`, NOT the requisition id. The `/callback` page needs the requisition id to call finalize. Fix by encoding the requisition id into the redirect URL at creation time.

**Files:** `server/routes/connect.ts` (modify)

- [ ] **Step 1: Modify the redirect to carry the requisition id**

In `server/routes/connect.ts`, the create flow currently sets
`redirect = ${env.APP_BASE_URL}/callback` BEFORE the requisition exists. Change
it to a two-step create: create the requisition, then it already returns its
`id`; GoCardless will redirect to our `redirect` with `?ref=<reference>`. Since
we also stored `reference`, resolve the id from the reference in finalize.

Replace the `/callback` resolution by adding a lookup endpoint. Update
`connectRouter` to add:

```typescript
connectRouter.get("/connect/by-ref/:ref", async (req, res, next) => {
  try {
    const reqn = await db.requisition.findFirst({ where: { reference: req.params.ref } });
    if (!reqn) { res.status(404).json({ message: "Unknown reference" }); return; }
    res.json({ id: reqn.id });
  } catch (err) { next(err); }
});
```

- [ ] **Step 2: Update `web/src/pages/Callback.tsx` to resolve id from ref**

Replace the effect body so it first resolves the id from `ref`:

```typescript
  useEffect(() => {
    const ref = params.get("ref");
    if (!ref) { setStatus("Missing requisition reference."); return; }
    fetch(`/api/connect/by-ref/${encodeURIComponent(ref)}`)
      .then((r) => r.json())
      .then(({ id }) => api.finalize(id))
      .then((r) => { setStatus(`Connected ${r.accounts} account(s).`); setTimeout(() => navigate("/"), 1200); })
      .catch((e) => setStatus(`Error: ${e.message}`));
  }, [params, navigate]);
```

- [ ] **Step 3: Verify compile + build**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec tsc --noEmit && pnpm exec vite build`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
cd /Users/mansoor/Developer/personal
git add finance/server/routes/connect.ts finance/web/src/pages/Callback.tsx
git commit -m "fix: resolve requisition id from ref on callback"
```

---

## Task 12: Dockerfile + run all tests

**Files:** `Dockerfile`

- [ ] **Step 1: Write `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec prisma generate && pnpm exec vite build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
CMD ["pnpm", "start"]
```

Note: `pnpm start` runs `prisma migrate deploy && tsx server/index.ts`. `tsx` is a
dev dependency present because we copy the whole built `/app` (including
node_modules) from the build stage.

- [ ] **Step 2: Run the full unit test suite**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm test`
Expected: PASS — token (3), categorize (6), aggregate (3) = 12 tests.

- [ ] **Step 3: Final type check + build**

Run: `pnpm exec tsc --noEmit && pnpm exec vite build`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
cd /Users/mansoor/Developer/personal
git add finance/Dockerfile
git commit -m "chore: add Dockerfile for Railway deploy"
```

---

## Task 13 (MANUAL — human + live account): local run, then deploy

Not for the implementer subagent. Requires real credentials, a Postgres, and
browser authentication.

- [ ] **Step 1: Provide credentials** — create `finance/.env` from `.env.example` with real `GOCARDLESS_SECRET_ID`/`KEY`, a local `DATABASE_URL`, `APP_BASE_URL=http://localhost:5173`.
- [ ] **Step 2: Start local Postgres** and run `pnpm exec prisma migrate dev --name init`.
- [ ] **Step 3:** `pnpm dev`, open `http://localhost:5173`, go to Connect, pick your bank, authenticate, confirm redirect → Dashboard shows accounts.
- [ ] **Step 4:** Click "Sync now", verify transactions/charts populate.
- [ ] **Step 5: Railway** — create service from the repo (Docker), add Postgres plugin, set env vars (`GOCARDLESS_*`, `APP_BASE_URL`=the Railway URL, `DATABASE_URL` from the plugin). Deploy; verify the live URL.

---

## Self-Review

- **Spec coverage:** connect flow (Tasks 8/11), sync with throttle + 429 (Task 8), dashboard aggregates + transactions (Tasks 7/8), categorization (Task 6), Postgres schema (Task 2), GoCardless client/token (Tasks 4/5), env validation (Task 3), frontend pages + charts (Task 10), single-service static serving (Task 9), Docker/Railway (Task 12/13), tests on the three pure units (Tasks 4/6/7). All spec sections mapped.
- **Placeholder scan:** no TBD/TODO; every code step is complete. The callback id/ref gap is explicitly closed in Task 11.
- **Type consistency:** DTOs in `shared/types.ts` (Task 3) are consumed unchanged by routes (Task 8) and `web/src/api.ts` (Task 10). `AggTx`, `categorize`, `TokenManager.get`, `GoCardlessClient` method names are consistent across tasks. `syncAccount` defined in Task 8 (sync.ts) and imported by connect.ts in the same task.
- **Known acceptance:** `added` counts processed rows (not strictly new) — documented; acceptable for v1.

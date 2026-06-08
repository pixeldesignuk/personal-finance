# Category Keys, People & Rules Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Stable category keys (rename-safe refs), a People dimension assigned per transaction (nullable), and a deterministic rules engine that auto-assigns category + person (overridable) — with proper management UIs.

**Architecture:** Add `Category.key` (refs switch from name→key), `Person` + `Rule` tables, `Transaction.personKey`. A pure `applyRules`/`slug` engine runs on sync + a re-apply action. Categories/People/Rules get dialog-based managers; Transactions gains a person column + filter. Old name-references migrated to keys.

**Tech Stack:** Existing — Express+TS, Prisma(v6)/Postgres, Vite/React, zod, Node `node:test`, tsx, pnpm.

**Env prefix:** `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)";`

**Git:** commit straight to `main` from `/Users/mansoor/Developer/personal/finance`, explicit paths, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. `.ts` import extensions. No local Postgres — `prisma generate`/tests/build work without a DB; controller applies migration to Railway (Task 14).

---

## Task 1: rules engine (TDD)

**Files:** `server/lib/rules.ts`, `server/lib/rules.test.ts`

- [ ] **Step 1: Write the failing test `server/lib/rules.test.ts`**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { slug, applyRules, type Rule } from "./rules.ts";

test("slug lowercases, hyphenates, strips punctuation", () => {
  assert.equal(slug("Electric & Gas"), "electric-gas");
  assert.equal(slug("  Maryam  Football "), "maryam-football");
  assert.equal(slug("M&S"), "m-s");
});

const rules: Rule[] = [
  { matchText: "tesco", categoryKey: "groceries", personKey: null, priority: 10 },
  { matchText: "football", categoryKey: null, personKey: "maryam", priority: 5 },
  { matchText: "british gas", categoryKey: "electric-gas", personKey: "household", priority: 1 },
];

test("applyRules sets category and person independently, case-insensitive", () => {
  assert.deepEqual(applyRules("TESCO STORES 1234", rules), { categoryKey: "groceries", personKey: undefined });
  assert.deepEqual(applyRules("Maryam Football club", rules), { categoryKey: undefined, personKey: "maryam" });
  assert.deepEqual(applyRules("BRITISH GAS", rules), { categoryKey: "electric-gas", personKey: "household" });
});

test("highest priority wins per field; no match -> empty", () => {
  const r: Rule[] = [
    { matchText: "amazon", categoryKey: "shopping", personKey: null, priority: 1 },
    { matchText: "amazon", categoryKey: "uncategorised", personKey: null, priority: 9 },
  ];
  assert.equal(applyRules("AMAZON UK", r).categoryKey, "uncategorised");
  assert.deepEqual(applyRules("nothing here", rules), { categoryKey: undefined, personKey: undefined });
});
```

- [ ] **Step 2: Run → fail**

Run: `node --import tsx --test server/lib/rules.test.ts`

- [ ] **Step 3: Write `server/lib/rules.ts`**

```typescript
export interface Rule {
  matchText: string;
  categoryKey: string | null;
  personKey: string | null;
  priority: number;
}

export function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function applyRules(text: string, rules: Rule[]): { categoryKey?: string; personKey?: string } {
  const hay = text.toLowerCase();
  const ordered = [...rules].sort((a, b) => b.priority - a.priority);
  let categoryKey: string | undefined;
  let personKey: string | undefined;
  for (const r of ordered) {
    if (!r.matchText || !hay.includes(r.matchText.toLowerCase())) continue;
    if (categoryKey === undefined && r.categoryKey) categoryKey = r.categoryKey;
    if (personKey === undefined && r.personKey) personKey = r.personKey;
    if (categoryKey !== undefined && personKey !== undefined) break;
  }
  return { categoryKey, personKey };
}
```

- [ ] **Step 4: Run → pass; commit**

Run: `node --import tsx --test server/lib/rules.test.ts`
```bash
git add server/lib/rules.ts server/lib/rules.test.ts
git commit -m "feat: rules engine (slug + applyRules)"
```

---

## Task 2: schema

**Files:** `prisma/schema.prisma` (modify)

- [ ] **Step 1: Edit `prisma/schema.prisma`.** Add `key String @unique` to `Category` (after `name`). In `CategoryTransfer` rename `fromName`/`toName` to `fromKey`/`toKey`. Add `personKey String?` to `Transaction` (after `categoryOverride`). Add:

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
  matchText   String
  categoryKey String?
  personKey   String?
  priority    Int      @default(0)
  createdAt   DateTime @default(now())
}
```

- [ ] **Step 2: Generate + validate**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec prisma generate && pnpm exec prisma validate`
Expected: generated; valid.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: schema for category key, Person, Rule, Transaction.personKey, transfer keys"
```

---

## Task 3: envelope engine → keys

**Files:** `server/lib/envelope.ts`, `server/lib/envelope.test.ts` (modify)

- [ ] **Step 1: Rename name→key in `server/lib/envelope.ts`.** In `EnvCategory` change `name` to `key`; in `EnvTransfer` change `fromName`/`toName` to `fromKey`/`toKey`; in `EnvelopeRow` change `name` to `key`. Update the body of `computeEnvelopes` to use `cat.key`, the override key `${cat.key}|${m}`, transfer `tr.toKey`/`tr.fromKey`, and return `{ key: cat.key, ... }`. (Transactions' `category` already holds the effective category key.)

- [ ] **Step 2: Update `server/lib/envelope.test.ts`** — change the fixtures to use `key` instead of `name` (e.g. `{ key: "groceries", monthlyAmount: 250, goal: null }`), txns `category: "groceries"`, transfers `{ fromKey: "rent", toKey: "emergency-fund", amount: 100 }`, and assertions `r.key === "groceries"`.

- [ ] **Step 3: Run → pass; commit**

Run: `node --import tsx --test server/lib/envelope.test.ts`
```bash
git add server/lib/envelope.ts server/lib/envelope.test.ts
git commit -m "refactor: envelope engine keyed by category key"
```

---

## Task 4: shared DTOs

**Files:** `shared/types.ts` (modify)

- [ ] **Step 1: Edit `shared/types.ts`.** Add `key: string;` to `CategoryDTO` (after `id`). Change `EnvelopeRowDTO` to add `key` + keep `name` (display):
```typescript
export interface EnvelopeRowDTO {
  key: string;
  name: string;
  allocated: number;
  spent: number;
  available: number;
  goal: number | null;
}
```
Add `personKey: string | null;` and `personName: string | null;` to `TransactionDTO`. Append:
```typescript
export interface PersonDTO {
  id: number;
  key: string;
  name: string;
  sortOrder: number;
  archived: boolean;
}
export interface RuleDTO {
  id: number;
  matchText: string;
  categoryKey: string | null;
  personKey: string | null;
  priority: number;
}
export interface CategoryNameDTO {
  key: string;
  name: string;
}
```

- [ ] **Step 2: Commit** (compile verified Task 10)

```bash
git add shared/types.ts
git commit -m "feat: DTOs for category key, person, rule, category-name"
```

---

## Task 5: categories route → keys

**Files:** `server/routes/categories.ts` (modify)

- [ ] **Step 1: In `server/routes/categories.ts`** import slug: add `import { slug } from "../lib/rules.ts";`. In the `GET /categories` DTO mapping add `key: c.key,` to each category object. Replace `/category-names` to return `{key,name}`:
```typescript
categoriesRouter.get("/category-names", async (_req, res, next) => {
  try {
    const cats = await db.category.findMany({ where: { archived: false }, orderBy: { name: "asc" } });
    res.json([...cats.map((c) => ({ key: c.key, name: c.name })), { key: "income", name: "Income" }, { key: "transfer", name: "Transfer" }]);
  } catch (err) { next(err); }
});
```
In `POST /categories`, set the key: change the create to
```typescript
    const key = slug(b.name);
    const c = await db.category.create({ data: { name: b.name, key, groupId: b.groupId, monthlyAmount: b.monthlyAmount, goal: b.goal ?? null } });
```
In `DELETE /categories/:id`, change the in-use check to reference the category **key**: replace `cat.name` with `cat.key` in the `count` where and keep the 409. The `PATCH` rename block (the `updateMany` on transactions) is **no longer needed** — delete the `if (b.name && b.name !== existing.name) { ... }` block entirely (keys are stable).

- [ ] **Step 2: Commit** (compile verified Task 10)

```bash
git add server/routes/categories.ts
git commit -m "feat: categories keyed (key on DTO, slug on create, key-based delete check)"
```

---

## Task 6: people route

**Files:** `server/routes/people.ts` (create)

- [ ] **Step 1: Write `server/routes/people.ts`**

```typescript
import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { slug } from "../lib/rules.ts";
import type { PersonDTO } from "../../shared/types.ts";

export const peopleRouter = Router();

peopleRouter.get("/people", async (_req, res, next) => {
  try {
    const people = await db.person.findMany({ where: { archived: false }, orderBy: { sortOrder: "asc" } });
    const dto: PersonDTO[] = people.map((p) => ({ id: p.id, key: p.key, name: p.name, sortOrder: p.sortOrder, archived: p.archived }));
    res.json(dto);
  } catch (err) { next(err); }
});

peopleRouter.post("/people", async (req, res, next) => {
  try {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    const p = await db.person.create({ data: { name, key: slug(name) } });
    res.json({ id: p.id, key: p.key });
  } catch (err) { next(err); }
});

peopleRouter.patch("/people/:id", async (req, res, next) => {
  try {
    const b = z.object({ name: z.string().min(1).optional(), sortOrder: z.number().int().optional(), archived: z.boolean().optional() }).parse(req.body);
    const updated = await db.person.update({ where: { id: Number(req.params.id) }, data: b });
    res.json({ id: updated.id });
  } catch (err) { next(err); }
});

peopleRouter.delete("/people/:id", async (req, res, next) => {
  try {
    const p = await db.person.findUnique({ where: { id: Number(req.params.id) } });
    if (!p) { res.status(404).json({ error: "Person not found" }); return; }
    const used = await db.transaction.count({ where: { personKey: p.key } });
    if (used > 0) { res.status(409).json({ error: "Person has transactions — archive instead." }); return; }
    await db.person.delete({ where: { id: p.id } });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});
```

- [ ] **Step 2: Commit** (compile verified Task 10)

```bash
git add server/routes/people.ts
git commit -m "feat: people route (CRUD, archive-if-used)"
```

---

## Task 7: rules route

**Files:** `server/routes/rules.ts` (create)

- [ ] **Step 1: Write `server/routes/rules.ts`**

```typescript
import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { applyRules, type Rule } from "../lib/rules.ts";
import { effectiveCategory } from "../lib/effectiveCategory.ts";
import type { RuleDTO } from "../../shared/types.ts";

export const rulesRouter = Router();

const ruleBody = z.object({
  matchText: z.string().min(1),
  categoryKey: z.string().nullable().optional(),
  personKey: z.string().nullable().optional(),
  priority: z.number().int().default(0),
}).refine((b) => b.categoryKey || b.personKey, "rule must set a category or a person");

rulesRouter.get("/rules", async (_req, res, next) => {
  try {
    const rules = await db.rule.findMany({ orderBy: [{ priority: "desc" }, { createdAt: "asc" }] });
    const dto: RuleDTO[] = rules.map((r) => ({ id: r.id, matchText: r.matchText, categoryKey: r.categoryKey, personKey: r.personKey, priority: r.priority }));
    res.json(dto);
  } catch (err) { next(err); }
});

rulesRouter.post("/rules", async (req, res, next) => {
  try {
    const b = ruleBody.parse(req.body);
    const r = await db.rule.create({ data: { matchText: b.matchText, categoryKey: b.categoryKey ?? null, personKey: b.personKey ?? null, priority: b.priority } });
    res.json({ id: r.id });
  } catch (err) { next(err); }
});

rulesRouter.patch("/rules/:id", async (req, res, next) => {
  try {
    const b = ruleBody.parse(req.body);
    await db.rule.update({ where: { id: Number(req.params.id) }, data: { matchText: b.matchText, categoryKey: b.categoryKey ?? null, personKey: b.personKey ?? null, priority: b.priority } });
    res.json({ id: Number(req.params.id) });
  } catch (err) { next(err); }
});

rulesRouter.delete("/rules/:id", async (req, res, next) => {
  try {
    await db.rule.delete({ where: { id: Number(req.params.id) } });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// Build the matchable text for a stored transaction row.
function txText(t: { merchantName: string | null; creditorName: string | null; debtorName: string | null; remittanceInfo: string | null }): string {
  return [t.merchantName, t.creditorName, t.debtorName, t.remittanceInfo].filter(Boolean).join(" ");
}

rulesRouter.post("/rules/apply", async (_req, res, next) => {
  try {
    const ruleRows = await db.rule.findMany();
    const rules: Rule[] = ruleRows.map((r) => ({ matchText: r.matchText, categoryKey: r.categoryKey, personKey: r.personKey, priority: r.priority }));
    const txns = await db.transaction.findMany();
    let categorised = 0;
    let personed = 0;
    for (const t of txns) {
      const result = applyRules(txText(t), rules);
      const data: { category?: string; personKey?: string } = {};
      if (result.categoryKey && effectiveCategory(t) === "uncategorised") { data.category = result.categoryKey; categorised++; }
      if (result.personKey && t.personKey == null) { data.personKey = result.personKey; personed++; }
      if (Object.keys(data).length) await db.transaction.update({ where: { id: t.id }, data });
    }
    res.json({ categorised, personed });
  } catch (err) { next(err); }
});
```

- [ ] **Step 2: Commit** (compile verified Task 10)

```bash
git add server/routes/rules.ts
git commit -m "feat: rules route (CRUD + re-apply over transactions)"
```

---

## Task 8: transactions route → person + key validation

**Files:** `server/routes/transactions.ts` (modify)

- [ ] **Step 1: Update validation + PATCH.** Change `categoryExists` to check by **key**:
```typescript
const RESERVED = new Set(["income", "transfer"]);
async function categoryExists(key: string): Promise<boolean> {
  if (RESERVED.has(key)) return true;
  return !!(await db.category.findFirst({ where: { key } }));
}
async function personExists(key: string): Promise<boolean> {
  return !!(await db.person.findFirst({ where: { key } }));
}
```
(The POST `categoryExists(body.category)` call now treats `category` as a key — the frontend submits keys.)

Replace the whole `PATCH /transactions/:id` handler with:
```typescript
transactionsRouter.patch("/transactions/:id", async (req, res, next) => {
  try {
    const b = z.object({
      category: z.string().min(1).optional(),
      personKey: z.string().nullable().optional(),
    }).parse(req.body);
    const tx = await db.transaction.findUnique({ where: { id: req.params.id } });
    if (!tx) { res.status(404).json({ error: "Transaction not found" }); return; }
    if (b.category !== undefined && !(await categoryExists(b.category))) { res.status(400).json({ error: "Unknown category" }); return; }
    if (b.personKey != null && !(await personExists(b.personKey))) { res.status(400).json({ error: "Unknown person" }); return; }
    const data: { categoryOverride?: string; personKey?: string | null } = {};
    if (b.category !== undefined) data.categoryOverride = b.category;
    if (b.personKey !== undefined) data.personKey = b.personKey;
    await db.transaction.update({ where: { id: req.params.id }, data });
    res.json({ id: req.params.id });
  } catch (err) { next(err); }
});
```

- [ ] **Step 2: Commit** (compile verified Task 10)

```bash
git add server/routes/transactions.ts
git commit -m "feat: transaction PATCH sets category(key)/person; key + person validation"
```

---

## Task 9: sync runs rules; dashboard transactions return person + person filter

**Files:** `server/routes/sync.ts`, `server/routes/dashboard.ts` (modify)

- [ ] **Step 1: In `server/routes/sync.ts`** run rules. Add imports at top:
```typescript
import { applyRules, type Rule } from "../lib/rules.ts";
```
Inside `syncAccount`, before the transaction loop, load rules once:
```typescript
  const ruleRows = await db.rule.findMany();
  const rules: Rule[] = ruleRows.map((r) => ({ matchText: r.matchText, categoryKey: r.categoryKey, personKey: r.personKey, priority: r.priority }));
```
In the loop, build text and compute category/person (replace the `const category = amount > 0 ? "income" : "Uncategorised";` line and the `text` build if present):
```typescript
    const text = [t.merchantName, t.creditorName, t.debtorName, t.remittanceInformationUnstructured].filter(Boolean).join(" ");
    const ruled = applyRules(text, rules);
    const category = ruled.categoryKey ?? (amount > 0 ? "income" : "uncategorised");
```
In the `create` data add `personKey: ruled.personKey ?? null,`. In the `update` data keep `{ category, status }` (do NOT set personKey on update — preserve manual/existing person).

- [ ] **Step 2: In `server/routes/dashboard.ts`** return person on transactions + add `?person=` filter. Add to the `/transactions` query parse: `person: z.string().optional()`. In its `where`, add the person filter:
```typescript
        ...(q.person ? { personKey: q.person === "none" ? null : q.person } : {}),
```
Change the transactions query to `include: { account: true }` if not already, and to resolve person names, fetch people once:
```typescript
    const people = await db.person.findMany();
    const personName = (k: string | null) => people.find((p) => p.key === k)?.name ?? null;
```
In the DTO map add `personKey: t.personKey, personName: personName(t.personKey),`. Add the same `person` filter option to `/dashboard` (parse `person`, and scope the txns/balances `where` with `...(person && person !== "all" ? { personKey: person === "none" ? null : person } : {})` on the transaction query only — balances have no person).

- [ ] **Step 3: Verify compile**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec prisma generate && pnpm exec tsc --noEmit`
Expected: exits 0 (some frontend may still reference old names — if tsc errors are only in web/ that depend on later tasks, note and proceed; the backend must compile).

- [ ] **Step 4: Commit**

```bash
git add server/routes/sync.ts server/routes/dashboard.ts
git commit -m "feat: sync applies rules (category+person); transactions expose+filter by person"
```

---

## Task 10: envelopes route → keys + person filter; telegram rules; mount; compile gate

**Files:** `server/routes/envelopes.ts`, `server/routes/telegram.ts`, `server/index.ts` (modify)

- [ ] **Step 1: `server/routes/envelopes.ts`** — switch to keys + person filter. Where it builds `EnvCategory` use `key: c.key` (not name). Build the override map keyed by `${c.key}|${month}`. Map transfers to `{ fromKey: t.fromKey, toKey: t.toKey, amount }`. When building the txns, keep `category: effectiveCategory(t)` (already a key). Add a `?person=` query: parse `person`, and when present filter the personal txns to `personKey === person` (or `null` when `none`). Attach the display name to each row: after `computeEnvelopes`, map rows to add `name` from a `keyToName` map built from the group's categories:
```typescript
      const keyToName = new Map(g.categories.map((c) => [c.key, c.name]));
      rows: computeEnvelopes(cats, overrides, transfers, envTxns, start, asOf).map((r) => ({ ...r, name: keyToName.get(r.key) ?? r.key })),
```
(Add `month`/`person` to the zod query object.)

- [ ] **Step 2: `server/routes/telegram.ts`** — run rules on cash entry. Add `import { applyRules, type Rule } from "../lib/rules.ts";`. In the message handler, after `normalizeParsed`, run rules over the note/text and apply category+person:
```typescript
    const ruleRows = await db.rule.findMany();
    const ruled = applyRules(msg.text, ruleRows.map((r) => ({ matchText: r.matchText, categoryKey: r.categoryKey, personKey: r.personKey, priority: r.priority })));
    const category = ruled.categoryKey ?? n.category; // n.category is "income"/"uncategorised"
    const personKey = ruled.personKey ?? null;
```
and in the `db.transaction.create` data set `category` (the ruled value) and add `personKey`. Note: `normalizeParsed` returns `category` "income"/"Uncategorised" — change the cashTxn fallback string to lowercase `uncategorised` (edit `server/lib/cashTxn.ts`: `parseTextExpense` returns `amount > 0 ? "income" : "uncategorised"`, and `normalizeParsed` blank-fallback to `"uncategorised"`; update its test assertions `"Uncategorised"`→`"uncategorised"`).

- [ ] **Step 3: `server/index.ts`** — add imports + mounts:
```typescript
import { peopleRouter } from "./routes/people.ts";
import { rulesRouter } from "./routes/rules.ts";
```
```typescript
app.use("/api", peopleRouter);
app.use("/api", rulesRouter);
```

- [ ] **Step 4: Full backend compile + tests**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm exec prisma generate && pnpm exec tsc --noEmit && pnpm test`
Expected: tsc 0; tests pass (prior 46 + rules ~4 = ~50; envelope/cashTxn tests updated, count unchanged net of edits).

- [ ] **Step 5: Commit**

```bash
git add server/routes/envelopes.ts server/routes/telegram.ts server/lib/cashTxn.ts server/lib/cashTxn.test.ts server/index.ts
git commit -m "feat: envelopes keyed + person filter; telegram applies rules; mount people+rules"
```

---

## Task 11: frontend api helpers

**Files:** `web/src/api.ts` (modify)

- [ ] **Step 1: Update imports + helpers.** Add `PersonDTO, RuleDTO, CategoryNameDTO` to the type import (and keep existing). Change `categoryNames` return type and add people/rules/person helpers; update `patchCategory`/transaction person:
```typescript
  categoryNames: () => get<CategoryNameDTO[]>("/api/category-names"),
  people: () => get<PersonDTO[]>("/api/people"),
  createPerson: (name: string) => send<{ id: number; key: string }>("POST", "/api/people", { name }),
  patchPerson: (id: number, patch: { name?: string; sortOrder?: number; archived?: boolean }) => send<{ id: number }>("PATCH", `/api/people/${id}`, patch),
  deletePerson: (id: number) => send<{ deleted: boolean }>("DELETE", `/api/people/${id}`),
  rules: () => get<RuleDTO[]>("/api/rules"),
  createRule: (input: { matchText: string; categoryKey?: string | null; personKey?: string | null; priority?: number }) => send<{ id: number }>("POST", "/api/rules", input),
  patchRule: (id: number, input: { matchText: string; categoryKey?: string | null; personKey?: string | null; priority: number }) => send<{ id: number }>("PATCH", `/api/rules/${id}`, input),
  deleteRule: (id: number) => send<{ deleted: boolean }>("DELETE", `/api/rules/${id}`),
  applyRules: () => send<{ categorised: number; personed: number }>("POST", "/api/rules/apply"),
  setTxnPerson: (id: string, personKey: string | null) => send<{ id: string }>("PATCH", `/api/transactions/${id}`, { personKey }),
```
Keep `setTxnCategory` (now submits a key). `transactions(search, accountId, person?)` — add a `person` param appended as `&person=...` when set. `envelopes(month, person?)` — append `&person=` when set (build the query carefully).

- [ ] **Step 2: Commit** (build verified Task 13)

```bash
git add web/src/api.ts
git commit -m "feat: api helpers for people, rules, person assignment, key-based category names"
```

---

## Task 12: management pages (Categories dialog, People, Rules) + Transactions person

**Files:** `web/src/pages/Categories.tsx` (replace), `web/src/pages/People.tsx` (create), `web/src/pages/Rules.tsx` (create), `web/src/pages/Transactions.tsx` (modify), `web/src/App.tsx` (modify)

- [ ] **Step 1: Replace `web/src/pages/Categories.tsx`** with a dialog-based manager:

```typescript
import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import type { CategoryGroupDTO } from "../../../shared/types.ts";
import { formatMoney } from "../format.ts";

export default function Categories() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [groups, setGroups] = useState<CategoryGroupDTO[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", groupId: 0, monthlyAmount: "0", goal: "" });

  const load = () => api.categories().then(setGroups).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  const wrap = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); dialog.current?.close(); } catch (e) { setMsg((e as Error).message); } };

  const openNew = (groupId: number) => { setEditId(null); setForm({ name: "", groupId, monthlyAmount: "0", goal: "" }); dialog.current?.showModal(); };
  const openEdit = (c: { id: number; name: string; groupId: number; monthlyAmount: number; goal: number | null }) => {
    setEditId(c.id); setForm({ name: c.name, groupId: c.groupId, monthlyAmount: String(c.monthlyAmount), goal: c.goal != null ? String(c.goal) : "" }); dialog.current?.showModal();
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const monthlyAmount = Number(form.monthlyAmount) || 0;
    const goal = form.goal.trim() === "" ? null : Number(form.goal);
    if (goal != null && Number.isNaN(goal)) { setMsg("Goal must be a number"); return; }
    if (editId == null) wrap(() => api.createCategory({ name: form.name, groupId: form.groupId, monthlyAmount, goal }));
    else wrap(() => api.patchCategory(editId, { name: form.name, groupId: form.groupId, monthlyAmount, goal }));
  };
  const addGroup = () => { const n = window.prompt("New group name:"); if (n) wrap(() => api.createGroup(n)); };
  const archive = (id: number) => { if (window.confirm("Archive this category?")) wrap(() => api.patchCategory(id, { archived: true })); };

  return (
    <div>
      <div className="row-between"><h1>Categories</h1><button className="btn-primary" onClick={addGroup}>Add group</button></div>
      {msg && <p className="muted">{msg}</p>}
      {groups.map((g) => (
        <div className="card" key={g.id}>
          <div className="row-between"><h3 style={{ margin: 0 }}>{g.name}</h3><button className="btn-sm" onClick={() => openNew(g.id)}>Add category</button></div>
          <table style={{ marginTop: 10 }}>
            <thead><tr><th>Name</th><th>Monthly</th><th>Goal</th><th></th></tr></thead>
            <tbody>
              {g.categories.map((c) => (
                <tr key={c.id}>
                  <td>{c.name} <span className="muted" style={{ fontSize: 12 }}>{c.key}</span></td>
                  <td className="num">£{formatMoney(c.monthlyAmount)}</td>
                  <td className="num">{c.goal != null ? `£${formatMoney(c.goal)}` : "—"}</td>
                  <td style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <button className="btn-sm" onClick={() => openEdit(c)}>Edit</button>
                    <button className="btn-danger btn-sm" onClick={() => archive(c.id)}>Archive</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <dialog ref={dialog} className="modal" onClick={(e) => { if (e.target === dialog.current) dialog.current?.close(); }}>
        <form className="modal-body" onSubmit={submit}>
          <h3 style={{ marginTop: 0 }}>{editId == null ? "New category" : "Edit category"}</h3>
          <label className="field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></label>
          <label className="field"><span>Group</span>
            <select value={form.groupId} onChange={(e) => setForm({ ...form, groupId: Number(e.target.value) })}>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          <div style={{ display: "flex", gap: 12 }}>
            <label className="field" style={{ flex: 1 }}><span>Monthly (£)</span><input inputMode="decimal" value={form.monthlyAmount} onChange={(e) => setForm({ ...form, monthlyAmount: e.target.value })} /></label>
            <label className="field" style={{ flex: 1 }}><span>Goal (£)</span><input inputMode="decimal" value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} placeholder="none" /></label>
          </div>
          <div className="modal-actions"><button type="button" onClick={() => dialog.current?.close()}>Cancel</button><button className="btn-primary" type="submit">Save</button></div>
        </form>
      </dialog>
    </div>
  );
}
```

- [ ] **Step 2: Create `web/src/pages/People.tsx`**

```typescript
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { PersonDTO } from "../../../shared/types.ts";

export default function People() {
  const [people, setPeople] = useState<PersonDTO[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => api.people().then(setPeople).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  const wrap = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); } catch (e) { setMsg((e as Error).message); } };
  const add = () => { const n = window.prompt("Person name:"); if (n) wrap(() => api.createPerson(n)); };
  const rename = (id: number, cur: string) => { const n = window.prompt("Rename:", cur); if (n && n !== cur) wrap(() => api.patchPerson(id, { name: n })); };
  const archive = (id: number) => { if (window.confirm("Archive this person?")) wrap(() => api.patchPerson(id, { archived: true })); };
  return (
    <div>
      <div className="row-between"><h1>People</h1><button className="btn-primary" onClick={add}>Add person</button></div>
      {msg && <p className="muted">{msg}</p>}
      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>Key</th><th></th></tr></thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td><td className="muted">{p.key}</td>
                <td style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button className="btn-sm" onClick={() => rename(p.id, p.name)}>Rename</button>
                  <button className="btn-danger btn-sm" onClick={() => archive(p.id)}>Archive</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `web/src/pages/Rules.tsx`**

```typescript
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { RuleDTO, CategoryNameDTO, PersonDTO } from "../../../shared/types.ts";

export default function Rules() {
  const [rules, setRules] = useState<RuleDTO[]>([]);
  const [cats, setCats] = useState<CategoryNameDTO[]>([]);
  const [people, setPeople] = useState<PersonDTO[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState({ matchText: "", categoryKey: "", personKey: "", priority: "0" });

  const load = () => { api.rules().then(setRules).catch(() => {}); api.categoryNames().then(setCats).catch(() => {}); api.people().then(setPeople).catch(() => {}); };
  useEffect(() => { load(); }, []);
  const wrap = async (fn: () => Promise<unknown>) => { try { await fn(); load(); } catch (e) { setMsg((e as Error).message); } };

  const add = () => {
    if (!draft.matchText.trim()) { setMsg("Enter a match phrase"); return; }
    if (!draft.categoryKey && !draft.personKey) { setMsg("Pick a category or a person"); return; }
    wrap(() => api.createRule({ matchText: draft.matchText.trim(), categoryKey: draft.categoryKey || null, personKey: draft.personKey || null, priority: Number(draft.priority) || 0 }));
    setDraft({ matchText: "", categoryKey: "", personKey: "", priority: "0" });
  };
  const reapply = () => wrap(async () => { const r = await api.applyRules(); setMsg(`Applied: ${r.categorised} categorised, ${r.personed} tagged`); });

  return (
    <div>
      <div className="row-between"><h1>Rules</h1><button onClick={reapply}>Re-apply rules now</button></div>
      {msg && <p className="muted">{msg}</p>}
      <div className="card">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input placeholder="match text (e.g. tesco)" value={draft.matchText} onChange={(e) => setDraft({ ...draft, matchText: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
          <select value={draft.categoryKey} onChange={(e) => setDraft({ ...draft, categoryKey: e.target.value })}>
            <option value="">— category —</option>{cats.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
          <select value={draft.personKey} onChange={(e) => setDraft({ ...draft, personKey: e.target.value })}>
            <option value="">— person —</option>{people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
          <input style={{ width: 70 }} value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} title="priority" />
          <button className="btn-primary" onClick={add}>Add</button>
        </div>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Match</th><th>Category</th><th>Person</th><th>Priority</th><th></th></tr></thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{r.matchText}</td>
                <td>{cats.find((c) => c.key === r.categoryKey)?.name ?? "—"}</td>
                <td>{people.find((p) => p.key === r.personKey)?.name ?? "—"}</td>
                <td className="num">{r.priority}</td>
                <td style={{ textAlign: "right" }}><button className="btn-danger btn-sm" onClick={() => wrap(() => api.deleteRule(r.id))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update `web/src/pages/Transactions.tsx`** — load people + category names (keyed), add a Person column with a dropdown, submit keys. Change the category-names fetch to the keyed shape:
```typescript
  const [catNames, setCatNames] = useState<{ key: string; name: string }[]>([]);
  const [people, setPeople] = useState<{ key: string; name: string }[]>([]);
  useEffect(() => { api.categoryNames().then(setCatNames).catch(() => setCatNames([])); api.people().then(setPeople).catch(() => setPeople([])); }, []);
```
Category `<select>`: `value={r.category}` (a key) and options `{catNames.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}`. Add a Person `<th>Person</th>` header and a cell:
```tsx
                <td>
                  <select value={r.personKey ?? ""} onChange={(e) => setPerson(r.id, e.target.value || null)}>
                    <option value="">—</option>
                    {people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
                  </select>
                </td>
```
Add `const setPerson = async (id: string, personKey: string | null) => { try { await api.setTxnPerson(id, personKey); await load(); } catch { /* ignore */ } };` and `setCategory` continues to call `api.setTxnCategory(id, key)`.

- [ ] **Step 5: `web/src/App.tsx`** — add People + Rules nav links and routes. `import People from "./pages/People.tsx"; import Rules from "./pages/Rules.tsx";`, nav links `<NavLink to="/people">People</NavLink>` and `<NavLink to="/rules">Rules</NavLink>`, routes `<Route path="/people" element={<People />} /><Route path="/rules" element={<Rules />} />`.

- [ ] **Step 6: Commit** (build verified Task 13)

```bash
git add web/src/pages/Categories.tsx web/src/pages/People.tsx web/src/pages/Rules.tsx web/src/pages/Transactions.tsx web/src/App.tsx
git commit -m "feat: category dialog manager, People + Rules pages, transaction person column"
```

---

## Task 13: full verification

- [ ] **Step 1:** `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm test && pnpm exec tsc --noEmit && pnpm exec vite build`
Expected: tests pass (≈50), tsc 0, build OK.

---

## Task 14: migration SQL (controller-applied to Railway)

**Files:** `scripts/migrations/2026-06-08-people-rules.sql` (create)

- [ ] **Step 1: Write the idempotent SQL.**

```sql
-- 1. Category.key (backfill from name slug, then unique)
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "key" TEXT;
UPDATE "Category" SET "key" = regexp_replace(regexp_replace(lower(trim("name")), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g') WHERE "key" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Category_key_key" ON "Category"("key");

-- 2. Remap Transaction.category / categoryOverride name -> key (income/transfer pass through)
UPDATE "Transaction" t SET "category" = c."key" FROM "Category" c WHERE t."category" = c."name";
UPDATE "Transaction" t SET "categoryOverride" = c."key" FROM "Category" c WHERE t."categoryOverride" = c."name";

-- 3. CategoryTransfer name columns -> key columns (rename if present; convert values)
ALTER TABLE "CategoryTransfer" RENAME COLUMN "fromName" TO "fromKey";
ALTER TABLE "CategoryTransfer" RENAME COLUMN "toName" TO "toKey";
UPDATE "CategoryTransfer" ct SET "fromKey" = c."key" FROM "Category" c WHERE ct."fromKey" = c."name";
UPDATE "CategoryTransfer" ct SET "toKey" = c."key" FROM "Category" c WHERE ct."toKey" = c."name";

-- 4. Transaction.personKey
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "personKey" TEXT;

-- 5. Person table + seed
CREATE TABLE IF NOT EXISTS "Person" ("id" SERIAL PRIMARY KEY, "key" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL, "sortOrder" INTEGER NOT NULL DEFAULT 0, "archived" BOOLEAN NOT NULL DEFAULT false);
INSERT INTO "Person" ("key","name","sortOrder") VALUES
  ('you','You',1),('halima','Halima',2),('maryam','Maryam',3),('maariyah','Maariyah',4),('household','Household',5)
  ON CONFLICT ("key") DO NOTHING;

-- 6. Rule table
CREATE TABLE IF NOT EXISTS "Rule" ("id" SERIAL PRIMARY KEY, "matchText" TEXT NOT NULL, "categoryKey" TEXT, "personKey" TEXT, "priority" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now());
```

Note: step 3's `RENAME COLUMN` errors if already renamed; guard each rename:
```sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='CategoryTransfer' AND column_name='fromName') THEN
    ALTER TABLE "CategoryTransfer" RENAME COLUMN "fromName" TO "fromKey";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='CategoryTransfer' AND column_name='toName') THEN
    ALTER TABLE "CategoryTransfer" RENAME COLUMN "toName" TO "toKey";
  END IF;
END $$;
```
(Use this guarded form instead of the bare `RENAME` lines.)

- [ ] **Step 2: Commit**

```bash
git add scripts/migrations/2026-06-08-people-rules.sql
git commit -m "chore: people + rules + category-key migration SQL"
```

---

## Task 15 (CONTROLLER / live): apply migration to Railway

Not for the implementer subagent.

- [ ] Apply `scripts/migrations/2026-06-08-people-rules.sql` to Railway (before/after: Category.key populated + unique, transactions remapped to keys, Person seeded 5, Rule table exists, CategoryTransfer columns renamed).
- [ ] Confirm `GET /api/people`, `GET /api/rules`, `GET /api/categories` (with keys), `GET /api/envelopes` still work on the deployed app.

---

## Self-Review

- **Spec coverage:** rules engine + slug (Task 1), schema key/Person/Rule/personKey/transfer-keys (Task 2/14), envelope keyed (Task 3), DTOs (Task 4), categories keyed + slug + key delete-check + names {key,name} (Task 5), people route (Task 6), rules route + apply (Task 7), transaction PATCH category(key)+person + validation (Task 8), sync runs rules + dashboard person filter/expose (Task 9), envelopes keyed + person filter + telegram rules + mounts (Task 10), api (Task 11), Categories dialog + People + Rules pages + Transactions person column + nav (Task 12), migration with name→key remap + seed (Task 14). All spec sections mapped.
- **Placeholder scan:** none; every code step is complete.
- **Type consistency:** `Rule`/`slug`/`applyRules` (Task 1) used in rules route (7), sync (9), telegram (10). `EnvCategory.key`/`EnvTransfer.fromKey/toKey`/`EnvelopeRow.key` (Task 3) consumed by envelopes route (10). `PersonDTO`/`RuleDTO`/`CategoryNameDTO` + `CategoryDTO.key` + `TransactionDTO.personKey/personName` (Task 4) used by routes (5–9) and `api.ts`/pages (11–12). `api.people/rules/applyRules/setTxnPerson/setTxnCategory` names consistent. Category/person pickers submit keys, render names throughout. cashTxn fallback lowercased to `uncategorised` (Task 10) consistent with sync.
- **Known acceptance:** substring-match rules only (no regex/amount); envelopes per-category (person is a filter); AI categorisation still out of scope.

import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "../lib/db.ts";
import { merchantToken } from "../categorise/helpers.ts";
import { effectiveCategory } from "../lib/effectiveCategory.ts";
import { normalizeText } from "../lib/rules.ts";

export const transactionsRouter = Router();

const RESERVED = new Set(["income", "transfer"]);
async function categoryExists(key: string): Promise<boolean> {
  if (RESERVED.has(key)) return true;
  return !!(await db.category.findFirst({ where: { key } }));
}
async function personExists(key: string): Promise<boolean> {
  return !!(await db.person.findFirst({ where: { key } }));
}

transactionsRouter.post("/transactions", async (req, res, next) => {
  try {
    const body = z
      .object({
        accountId: z.string().min(1),
        date: z.string().min(1),
        amount: z.string().regex(/^-?\d+(\.\d+)?$/, "amount must be a number"),
        category: z.string().min(1),
        note: z.string().optional(),
      })
      .parse(req.body);
    if (!(await categoryExists(body.category))) {
      res.status(400).json({ error: "Unknown category" });
      return;
    }
    const account = await db.account.findUnique({ where: { id: body.accountId } });
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    if (account.source !== "MANUAL") {
      res.status(400).json({ error: "Manual transactions can only be added to manual accounts" });
      return;
    }
    const tx = await db.transaction.create({
      data: {
        id: `manual-${randomUUID()}`,
        accountId: body.accountId,
        bookingDate: body.date,
        amount: body.amount,
        currency: account.currency ?? "GBP",
        category: body.category,
        remittanceInfo: body.note ?? null,
        status: "booked",
        raw: { manual: true },
      },
    });
    res.json({ id: tx.id });
  } catch (err) {
    next(err);
  }
});

transactionsRouter.patch("/transactions/:id", async (req, res, next) => {
  try {
    const b = z.object({
      category: z.string().min(1).optional(),
      personKey: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
      name: z.string().optional(),
      flag: z.enum(["red", "orange", "yellow"]).nullable().optional(),
    }).parse(req.body);
    const tx = await db.transaction.findUnique({ where: { id: req.params.id } });
    if (!tx) { res.status(404).json({ error: "Transaction not found" }); return; }
    if (b.category !== undefined && !(await categoryExists(b.category))) { res.status(400).json({ error: "Unknown category" }); return; }
    if (b.personKey != null && !(await personExists(b.personKey))) { res.status(400).json({ error: "Unknown person" }); return; }
    const data: { categoryOverride?: string; personKey?: string | null; note?: string | null; flag?: string | null; merchantName?: string | null } = {};
    if (b.category !== undefined) data.categoryOverride = b.category;
    if (b.personKey !== undefined) data.personKey = b.personKey;
    if (b.note !== undefined) { const n = b.note?.trim(); data.note = n ? n : null; }
    if (b.name !== undefined) { const n = b.name.trim(); data.merchantName = n || null; }
    if (b.flag !== undefined) data.flag = b.flag;
    await db.transaction.update({ where: { id: req.params.id }, data });
    res.json({ id: req.params.id });
  } catch (err) { next(err); }
});

// Derive a matchable token for a rule from a transaction. Prefer a clean
// merchant token; if every name field is too short/numeric for that, fall back
// to the raw concatenated text so a rule can still be created (only truly empty
// transactions — e.g. a note-less cash entry — return null).
function deriveToken(tx: {
  merchantName: string | null; creditorName: string | null;
  debtorName: string | null; remittanceInfo: string | null;
}): string | null {
  for (const c of [tx.merchantName, tx.creditorName, tx.debtorName, tx.remittanceInfo]) {
    const t = merchantToken(c);
    if (t) return t;
  }
  const raw = [tx.merchantName, tx.creditorName, tx.debtorName, tx.remittanceInfo]
    .filter(Boolean).join(" ").toLowerCase().replace(/\s+/g, " ").trim();
  return raw.length >= 2 ? raw.slice(0, 60) : null;
}

// Create or update the merchant rule for `token`, setting only the given field.
async function upsertRule(token: string, patch: { categoryKey?: string; personKey?: string | null }) {
  const existing = await db.rule.findFirst({ where: { matchText: token } });
  if (existing) { await db.rule.update({ where: { id: existing.id }, data: patch }); return; }
  await db.rule.create({ data: { matchText: token, categoryKey: patch.categoryKey ?? null, personKey: patch.personKey ?? null, priority: 50 } });
}

// Propagate a transaction's category OR person to every matching transaction
// (old and new) by learning/updating a merchant rule, then applying it.
transactionsRouter.post("/transactions/:id/apply-to-matching", async (req, res, next) => {
  try {
    const b = z.object({ fields: z.array(z.enum(["category", "person"])).min(1) }).parse(req.body);
    const tx = await db.transaction.findUnique({ where: { id: req.params.id } });
    if (!tx) { res.status(404).json({ error: "Transaction not found" }); return; }
    const token = deriveToken(tx);
    if (!token) { res.status(400).json({ error: "This transaction has no name/description to build a rule from." }); return; }

    // Match in app code with whitespace-insensitive comparison — bank data pads
    // names with multiple spaces, which a literal SQL `contains` would miss.
    const all = await db.transaction.findMany({
      select: { id: true, merchantName: true, creditorName: true, debtorName: true, remittanceInfo: true, categoryOverride: true },
    });
    const matches = all.filter((t) =>
      normalizeText([t.merchantName, t.creditorName, t.debtorName, t.remittanceInfo].filter(Boolean).join(" ")).includes(token),
    );
    const ids = matches.map((m) => m.id);
    const applied: string[] = [];

    if (b.fields.includes("category")) {
      const value = effectiveCategory(tx);
      if (value && value !== "uncategorised") {
        await upsertRule(token, { categoryKey: value });
        // Set base category on matching rows; leave manual overrides alone.
        const noOverride = matches.filter((m) => m.categoryOverride == null).map((m) => m.id);
        if (noOverride.length) await db.transaction.updateMany({ where: { id: { in: noOverride } }, data: { category: value } });
        applied.push("category");
      }
    }
    if (b.fields.includes("person")) {
      const value = tx.personKey;
      if (value != null) await upsertRule(token, { personKey: value });
      else { const ex = await db.rule.findFirst({ where: { matchText: token } }); if (ex) await db.rule.update({ where: { id: ex.id }, data: { personKey: null } }); }
      if (ids.length) await db.transaction.updateMany({ where: { id: { in: ids } }, data: { personKey: value } });
      applied.push("person");
    }
    res.json({ matched: ids.length, applied, token });
  } catch (err) { next(err); }
});

const dec2 = (v: { toString(): string } | null | undefined): number => (v == null ? 0 : Number(v.toString()));

// Link a repayment to a debt: reduces the debt's balance by the payment amount
// and excludes the transaction from spending (it's a transfer, not consumption).
transactionsRouter.post("/transactions/:id/link-debt", async (req, res, next) => {
  try {
    const b = z.object({ debtAccountId: z.string().min(1) }).parse(req.body);
    const tx = await db.transaction.findUnique({ where: { id: req.params.id } });
    if (!tx) { res.status(404).json({ error: "Transaction not found" }); return; }
    const debt = await db.account.findUnique({ where: { id: b.debtAccountId } });
    if (!debt || debt.source !== "LIABILITY") { res.status(400).json({ error: "Not a debt account" }); return; }
    if (tx.debtAccountId === debt.id) { res.json({ linked: true }); return; } // already linked — don't double-apply

    const amount = Math.abs(Number(tx.amount));
    // Reverse a previous link to a different debt.
    if (tx.debtAccountId) {
      const old = await db.account.findUnique({ where: { id: tx.debtAccountId } });
      if (old?.source === "LIABILITY") await db.account.update({ where: { id: old.id }, data: { manualBalance: (dec2(old.manualBalance) + amount).toString() } });
    }
    await db.account.update({ where: { id: debt.id }, data: { manualBalance: (dec2(debt.manualBalance) - amount).toString() } });
    await db.transaction.update({ where: { id: tx.id }, data: { debtAccountId: debt.id, categoryOverride: "transfer" } });
    res.json({ linked: true });
  } catch (err) { next(err); }
});

transactionsRouter.post("/transactions/:id/unlink-debt", async (req, res, next) => {
  try {
    const tx = await db.transaction.findUnique({ where: { id: req.params.id } });
    if (!tx) { res.status(404).json({ error: "Transaction not found" }); return; }
    if (tx.debtAccountId) {
      const debt = await db.account.findUnique({ where: { id: tx.debtAccountId } });
      if (debt?.source === "LIABILITY") await db.account.update({ where: { id: debt.id }, data: { manualBalance: (dec2(debt.manualBalance) + Math.abs(Number(tx.amount))).toString() } });
    }
    await db.transaction.update({ where: { id: tx.id }, data: { debtAccountId: null, categoryOverride: null } });
    res.json({ unlinked: true });
  } catch (err) { next(err); }
});

// Assign one category to many transactions at once (manual reconcile).
transactionsRouter.post("/transactions/bulk-category", async (req, res, next) => {
  try {
    const b = z.object({ ids: z.array(z.string().min(1)).min(1), category: z.string().min(1) }).parse(req.body);
    if (!(await categoryExists(b.category))) { res.status(400).json({ error: "Unknown category" }); return; }
    const r = await db.transaction.updateMany({ where: { id: { in: b.ids } }, data: { categoryOverride: b.category } });
    res.json({ updated: r.count });
  } catch (err) { next(err); }
});

transactionsRouter.delete("/transactions/:id", async (req, res, next) => {
  try {
    const tx = await db.transaction.findUnique({ where: { id: req.params.id }, include: { account: true } });
    if (!tx) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }
    if (tx.account.source !== "MANUAL") {
      res.status(400).json({ error: "Only manual transactions can be deleted" });
      return;
    }
    await db.transaction.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { merchantToken } from "../categorise/helpers.ts";
import { effectiveCategory } from "../lib/effectiveCategory.ts";
import { monthOf } from "../lib/budget.ts";
import { classifyMerchant, coefficientOfVariation, median, type RecurType } from "../lib/merchants.ts";
import { rawMerchantName } from "../../shared/merchantName.ts";
import { toEmailOrderDTO } from "../plugins/emailOrderDTO.ts";
import { recordSyncRun } from "../lib/syncRun.ts";
import { cleanseData } from "../lib/cleanse.ts";
import type { AuditFn } from "../categorise/audit.ts";
import type { MerchantsDTO, MerchantDTO } from "../../shared/types.ts";

export const merchantsRouter = Router();

// Streamed AI data cleanse: merchant names, logo domains, categorisation.
merchantsRouter.post("/cleanse/stream", async (_req, res) => {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  const stream: AuditFn = (e) => res.write(`${JSON.stringify(e)}\n`);
  try {
    await recordSyncRun("cleanse", stream, (audit) => cleanseData(audit));
  } catch {
    // already streamed (fatal) + recorded
  } finally {
    res.end();
  }
});

const tokenOf = (t: { merchantName: string | null; creditorName: string | null; debtorName: string | null; remittanceInfo: string | null }) =>
  merchantToken(rawMerchantName(t));

merchantsRouter.get("/merchants", async (_req, res, next) => {
  try {
    const txns = await db.transaction.findMany({
      select: { accountId: true, merchantName: true, creditorName: true, debtorName: true, remittanceInfo: true, amount: true, bookingDate: true, category: true, categoryOverride: true, personKey: true },
    });
    const overrides = new Map((await db.merchant.findMany()).map((m) => [m.token, m]));
    // accountId → owning bank, so each merchant can show the account it's paid from.
    const accts = await db.account.findMany({ include: { requisition: true } });
    const bankByAccount = new Map(accts.map((a) => [a.id, { name: a.requisition?.institutionName ?? a.name ?? null, logo: a.requisition?.institutionLogo ?? null }]));
    // Matched Gmail orders per merchant — joined via the order's transaction token.
    const matchedOrders = await db.emailOrder.findMany({ where: { transactionId: { not: null }, total: { not: null } }, select: { transactionId: true } });
    const orderTxns = matchedOrders.length ? await db.transaction.findMany({ where: { id: { in: [...new Set(matchedOrders.map((o) => o.transactionId!))] } }, select: { id: true, merchantName: true, creditorName: true, debtorName: true, remittanceInfo: true } }) : [];
    const tokenByTxn = new Map(orderTxns.map((t) => [t.id, tokenOf(t)]));
    const orderCountByToken = new Map<string, number>();
    for (const o of matchedOrders) { const tok = tokenByTxn.get(o.transactionId!); if (tok) orderCountByToken.set(tok, (orderCountByToken.get(tok) ?? 0) + 1); }
    // A merchant's rule may be linked by merchantId (new) or just match by token
    // (older rules) — index both so existing priorities/categories show.
    const allRules = await db.rule.findMany();
    const ruleByMerchant = new Map<string, (typeof allRules)[number]>();
    const ruleByMatch = new Map<string, (typeof allRules)[number]>();
    for (const r of allRules) {
      if (r.merchantId) ruleByMerchant.set(r.merchantId, r);
      if (!ruleByMatch.has(r.matchText)) ruleByMatch.set(r.matchText, r);
    }

    interface Agg { name: Map<string, number>; amounts: number[]; months: Set<string>; last: string | null; cats: Map<string, number>; persons: Map<string, number>; accounts: Map<string, number>; }
    const groups = new Map<string, Agg>();
    for (const t of txns) {
      const amt = Number(t.amount);
      const eff = effectiveCategory(t);
      if (amt >= 0 || eff === "transfer" || eff === "income") continue; // spending only
      const token = tokenOf(t);
      if (!token) continue;
      const g: Agg = groups.get(token) ?? { name: new Map(), amounts: [], months: new Set(), last: null, cats: new Map(), persons: new Map(), accounts: new Map() };
      const rawName = rawMerchantName(t) ?? token;
      g.name.set(rawName, (g.name.get(rawName) ?? 0) + 1);
      g.amounts.push(Math.abs(amt));
      if (t.bookingDate) { const m = monthOf(t.bookingDate); if (m) g.months.add(m); if (!g.last || t.bookingDate > g.last) g.last = t.bookingDate; }
      g.cats.set(eff, (g.cats.get(eff) ?? 0) + 1);
      if (t.personKey) g.persons.set(t.personKey, (g.persons.get(t.personKey) ?? 0) + 1);
      g.accounts.set(t.accountId, (g.accounts.get(t.accountId) ?? 0) + 1);
      groups.set(token, g);
    }

    const top = <T,>(m: Map<T, number>): T | null => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const merchants: MerchantDTO[] = [];
    for (const [token, g] of groups) {
      const totalSpent = g.amounts.reduce((a, b) => a + b, 0);
      const monthsActive = Math.max(1, g.months.size);
      const perMonth = g.amounts.length / monthsActive;
      const detected = classifyMerchant(g.months.size, perMonth, coefficientOfVariation(g.amounts));
      const ov = overrides.get(token);
      const override = (ov?.recurring as MerchantDTO["override"]) ?? "auto";
      const effective: MerchantDTO["effective"] = override === "auto" ? detected : override;
      const monthlyTypical = effective === "fixed" ? median(g.amounts) : totalSpent / monthsActive;
      const statement = top(g.name) ?? token;
      const rule = ruleByMerchant.get(token) ?? ruleByMatch.get(token);
      const topAccount = top(g.accounts);
      const bank = topAccount ? bankByAccount.get(topAccount) : null;
      merchants.push({
        token,
        name: ov?.name ?? null,
        domain: ov?.domain ?? null,
        statement,
        accountName: bank?.name ?? null,
        accountLogo: bank?.logo ?? null,
        orderCount: orderCountByToken.get(token) ?? 0,
        categoryKey: rule?.categoryKey ?? top(g.cats),
        categoryFromRule: Boolean(rule?.categoryKey),
        personKey: rule?.personKey ?? top(g.persons),
        priority: rule?.priority ?? 0,
        totalSpent: Number(totalSpent.toFixed(2)),
        txnCount: g.amounts.length,
        monthsActive: g.months.size,
        monthlyTypical: Number(monthlyTypical.toFixed(2)),
        lastDate: g.last,
        detected,
        override,
        effective,
      });
    }
    merchants.sort((a, b) => b.totalSpent - a.totalSpent);

    const sumBy = (t: RecurType | "ignore") => merchants.filter((m) => m.effective === t).reduce((s, m) => s + m.monthlyTypical, 0);
    const dto: MerchantsDTO = {
      merchants,
      monthlyOutgoings: Number(sumBy("fixed").toFixed(2)),
      variableMonthly: Number(sumBy("variable").toFixed(2)),
    };
    res.json(dto);
  } catch (err) { next(err); }
});

// Recent Gmail orders for one merchant (joined via that merchant's transactions).
merchantsRouter.get("/merchants/:token/orders", async (req, res, next) => {
  try {
    const token = req.params.token;
    const txns = await db.transaction.findMany({ select: { id: true, merchantName: true, creditorName: true, debtorName: true, remittanceInfo: true } });
    const ids = txns.filter((t) => tokenOf(t) === token).map((t) => t.id);
    const rows = ids.length
      ? await db.emailOrder.findMany({ where: { transactionId: { in: ids }, total: { not: null } }, orderBy: [{ emailDate: "desc" }, { createdAt: "desc" }], take: 100 })
      : [];
    res.json(rows.map(toEmailOrderDTO));
  } catch (err) { next(err); }
});

// Turn every auto-detected merchant category into a real rule (for merchants
// that don't already have one). Makes the suggestions authoritative.
merchantsRouter.post("/merchants/confirm-detected", async (_req, res, next) => {
  try {
    const txns = await db.transaction.findMany({ select: { merchantName: true, creditorName: true, debtorName: true, remittanceInfo: true, amount: true, category: true, categoryOverride: true } });
    const ruled = new Set((await db.rule.findMany({ where: { NOT: { merchantId: null } } })).map((r) => r.merchantId));
    const cats = new Map<string, Map<string, number>>();
    for (const t of txns) {
      const amt = Number(t.amount);
      const eff = effectiveCategory(t);
      if (amt >= 0 || eff === "transfer" || eff === "income" || eff === "uncategorised") continue;
      const token = tokenOf(t);
      if (!token || ruled.has(token)) continue;
      const m = cats.get(token) ?? new Map();
      m.set(eff, (m.get(eff) ?? 0) + 1);
      cats.set(token, m);
    }
    let created = 0;
    for (const [token, m] of cats) {
      const detected = [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (!detected) continue;
      await db.rule.create({ data: { matchText: token, merchantId: token, categoryKey: detected, priority: 50 } });
      created++;
    }
    res.json({ created });
  } catch (err) { next(err); }
});

merchantsRouter.patch("/merchants/:token", async (req, res, next) => {
  try {
    const b = z.object({
      name: z.string().nullable().optional(),
      domain: z.string().nullable().optional(),
      recurring: z.enum(["auto", "fixed", "variable", "ignore"]).optional(),
      categoryKey: z.string().nullable().optional(),
      personKey: z.string().nullable().optional(),
      priority: z.number().int().optional(),
    }).parse(req.body);
    const token = req.params.token;
    const cleanDomain = (d: string | null | undefined) =>
      d === undefined ? undefined : d ? d.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim() || null : null;

    // Merchant holds the human name + recurring classification.
    await db.merchant.upsert({
      where: { token },
      create: { token, name: b.name ?? null, domain: cleanDomain(b.domain) ?? null, recurring: b.recurring ?? "auto" },
      update: {
        ...(b.name !== undefined ? { name: b.name } : {}),
        ...(b.domain !== undefined ? { domain: cleanDomain(b.domain) } : {}),
        ...(b.recurring !== undefined ? { recurring: b.recurring } : {}),
      },
    });

    // The linked rule is the source of truth for category/person/priority.
    if (b.categoryKey !== undefined || b.personKey !== undefined || b.priority !== undefined) {
      const existing = await db.rule.findFirst({ where: { merchantId: token } }) ?? await db.rule.findFirst({ where: { matchText: token } });
      const categoryKey = b.categoryKey !== undefined ? b.categoryKey : (existing?.categoryKey ?? null);
      const personKey = b.personKey !== undefined ? b.personKey : (existing?.personKey ?? null);
      const priority = b.priority !== undefined ? b.priority : (existing?.priority ?? 50);
      if (categoryKey || personKey) {
        const data = { matchText: token, merchantId: token, categoryKey, personKey, priority };
        if (existing) await db.rule.update({ where: { id: existing.id }, data });
        else await db.rule.create({ data });
      } else if (existing) {
        await db.rule.delete({ where: { id: existing.id } }); // nothing left to match → remove
      }
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

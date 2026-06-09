import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { merchantToken } from "../categorise/helpers.ts";
import { effectiveCategory } from "../lib/effectiveCategory.ts";
import { monthOf } from "../lib/budget.ts";
import { classifyMerchant, coefficientOfVariation, median, type RecurType } from "../lib/merchants.ts";
import type { MerchantsDTO, MerchantDTO } from "../../shared/types.ts";

export const merchantsRouter = Router();

const tokenOf = (t: { merchantName: string | null; creditorName: string | null; debtorName: string | null; remittanceInfo: string | null }) =>
  merchantToken(t.merchantName ?? t.creditorName ?? t.debtorName ?? t.remittanceInfo ?? null);

merchantsRouter.get("/merchants", async (_req, res, next) => {
  try {
    const txns = await db.transaction.findMany({
      select: { merchantName: true, creditorName: true, debtorName: true, remittanceInfo: true, amount: true, bookingDate: true, category: true, categoryOverride: true },
    });
    const overrides = new Map((await db.merchant.findMany()).map((m) => [m.token, m]));

    interface Agg { name: Map<string, number>; amounts: number[]; months: Set<string>; last: string | null; cats: Map<string, number>; }
    const groups = new Map<string, Agg>();
    for (const t of txns) {
      const amt = Number(t.amount);
      const eff = effectiveCategory(t);
      if (amt >= 0 || eff === "transfer" || eff === "income") continue; // spending only
      const token = tokenOf(t);
      if (!token) continue;
      const g: Agg = groups.get(token) ?? { name: new Map(), amounts: [], months: new Set(), last: null, cats: new Map() };
      const rawName = t.merchantName ?? t.creditorName ?? t.debtorName ?? t.remittanceInfo ?? token;
      g.name.set(rawName, (g.name.get(rawName) ?? 0) + 1);
      g.amounts.push(Math.abs(amt));
      if (t.bookingDate) { const m = monthOf(t.bookingDate); if (m) g.months.add(m); if (!g.last || t.bookingDate > g.last) g.last = t.bookingDate; }
      g.cats.set(eff, (g.cats.get(eff) ?? 0) + 1);
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
      merchants.push({
        token,
        name: ov?.name ?? top(g.name) ?? token,
        totalSpent: Number(totalSpent.toFixed(2)),
        txnCount: g.amounts.length,
        monthsActive: g.months.size,
        monthlyTypical: Number(monthlyTypical.toFixed(2)),
        lastDate: g.last,
        category: top(g.cats),
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

merchantsRouter.patch("/merchants/:token", async (req, res, next) => {
  try {
    const b = z.object({ name: z.string().optional(), recurring: z.enum(["auto", "fixed", "variable", "ignore"]).optional() }).parse(req.body);
    const token = req.params.token;
    await db.merchant.upsert({
      where: { token },
      create: { token, name: b.name ?? null, recurring: b.recurring ?? "auto" },
      update: { ...(b.name !== undefined ? { name: b.name } : {}), ...(b.recurring !== undefined ? { recurring: b.recurring } : {}) },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

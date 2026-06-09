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
    const rules = await db.rule.findMany({ where: { merchantId: null }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] });
    const dto: RuleDTO[] = rules.map((r) => ({ id: r.id, matchText: r.matchText, categoryKey: r.categoryKey, personKey: r.personKey, priority: r.priority, auto: r.auto }));
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

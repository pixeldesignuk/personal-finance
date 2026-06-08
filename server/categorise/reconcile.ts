import { db } from "../lib/db.ts";
import { applyRules, type Rule } from "../lib/rules.ts";
import { effectiveCategory } from "../lib/effectiveCategory.ts";
import { classifyBatch, geminiEnabled } from "./gemini.ts";
import { merchantToken } from "./helpers.ts";
import type { AuditFn } from "./audit.ts";
import type { ReconcileResult } from "../../shared/types.ts";

export interface ReconcileOpts {
  accountId?: string;
  audit?: AuditFn;     // structured trace events (the audit CLI prints them)
  dryRun?: boolean;    // when true, classify + report but write nothing to the DB
}

interface TxnRow {
  id: string;
  category: string;
  categoryOverride: string | null;
  merchantName: string | null;
  creditorName: string | null;
  debtorName: string | null;
  remittanceInfo: string | null;
}

function txText(t: TxnRow): string {
  return [t.merchantName, t.creditorName, t.debtorName, t.remittanceInfo].filter(Boolean).join(" ");
}
function learnName(t: TxnRow): string | null {
  return t.merchantName ?? t.creditorName ?? t.debtorName ?? null;
}

// Auto-categorise uncategorised transactions: deterministic rules first (free),
// then Gemini Flash for whatever's left, learning a merchant->category rule from
// each LLM decision so the next sync categorises it for free. Never touches a
// manual override or an already-categorised row. Scope to one account, or all.
export async function reconcile(opts: ReconcileOpts = {}): Promise<ReconcileResult> {
  const { accountId, audit, dryRun = false } = opts;
  const rows = (await db.transaction.findMany({
    where: accountId ? { accountId } : {},
    select: {
      id: true, category: true, categoryOverride: true,
      merchantName: true, creditorName: true, debtorName: true, remittanceInfo: true,
    },
  })) as TxnRow[];
  const candidates = rows.filter((t) => effectiveCategory(t) === "uncategorised");

  const cats = await db.category.findMany({ where: { archived: false }, select: { key: true, name: true, group: true } });
  const categoryOptions = cats.map((c) => ({ key: c.key, name: c.name, group: c.group }));
  const validKeys = new Set(categoryOptions.map((c) => c.key));
  audit?.({ kind: "scope", total: rows.length, uncategorised: candidates.length, categories: categoryOptions.map((c) => c.key) });

  const ruleRows = await db.rule.findMany();
  const rules: Rule[] = ruleRows.map((r) => ({
    matchText: r.matchText, categoryKey: r.categoryKey, personKey: r.personKey, priority: r.priority,
  }));

  // 1. Rules pass (free).
  let byRules = 0;
  const remaining: { id: string; text: string; name: string | null }[] = [];
  for (const t of candidates) {
    const text = txText(t);
    const ruled = applyRules(text, rules);
    if (ruled.categoryKey && validKeys.has(ruled.categoryKey)) {
      if (!dryRun) await db.transaction.update({ where: { id: t.id }, data: { category: ruled.categoryKey } });
      audit?.({ kind: "assign", id: t.id, name: learnName(t) ?? text, to: ruled.categoryKey, via: "rule" });
      byRules++;
    } else {
      remaining.push({ id: t.id, text, name: learnName(t) });
    }
  }
  audit?.({ kind: "rules", categorised: byRules, remaining: remaining.length });

  // 2. LLM pass (Gemini Flash) for the rest, then learn a rule from each pick.
  const llmSkipped = !geminiEnabled();
  let byLlm = 0;
  let rulesLearned = 0;
  if (!llmSkipped && remaining.length) {
    const picks = await classifyBatch(remaining.map((r) => ({ id: r.id, text: r.text })), categoryOptions, audit);
    const nameById = new Map(remaining.map((r) => [r.id, r.name]));
    const textById = new Map(remaining.map((r) => [r.id, r.text]));
    const existingMatch = new Set(ruleRows.map((r) => r.matchText.toLowerCase()));
    const learnedThisRun = new Set<string>();
    for (const [id, key] of picks) {
      if (key === "uncategorised") {
        audit?.({ kind: "skip-uncategorised", id, name: nameById.get(id) ?? textById.get(id) ?? id });
        continue;
      }
      if (!dryRun) await db.transaction.update({ where: { id }, data: { category: key } });
      audit?.({ kind: "assign", id, name: nameById.get(id) ?? textById.get(id) ?? id, to: key, via: "llm" });
      byLlm++;
      const token = merchantToken(nameById.get(id) ?? null);
      if (token && !existingMatch.has(token) && !learnedThisRun.has(token)) {
        if (!dryRun) await db.rule.create({ data: { matchText: token, categoryKey: key, personKey: null, priority: 0, auto: true } });
        audit?.({ kind: "learn", matchText: token, categoryKey: key });
        learnedThisRun.add(token);
        rulesLearned++;
      }
    }
  }

  const result = { total: candidates.length, byRules, byLlm, rulesLearned, llmSkipped };
  audit?.({ kind: "summary", result });
  return result;
}

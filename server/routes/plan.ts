// server/routes/plan.ts
import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { currentMonth, personalSpendByCategory, type BudgetTx } from "../lib/budget.ts";
import { NEEDS_KEYS } from "../../shared/categoryClass.ts";
import { currentBalance } from "../lib/balance.ts";
import { manualTxnSums } from "../lib/manualBalance.ts";
import { effectiveCategory } from "../lib/effectiveCategory.ts";
import { displayName } from "../../shared/displayName.ts";
import { computeFunding, tallyIncomeByAccount, type FundingSchedule } from "../lib/funding.ts";
import { getStringSettings, setStringSetting } from "../lib/settings.ts";
import { averageMonthly, computeSurplus, computePlanSteps } from "../lib/plan.ts";
import type { PlanDTO, PlanOverride } from "../../shared/types.ts";

export const planRouter = Router();

function prevMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
}

// Parse the plan.overrides JSON setting into a { stepKey: "handled"|"na" } map.
function parseOverrides(raw: string | undefined): Record<string, PlanOverride> {
  try {
    const o = JSON.parse(raw || "{}");
    if (!o || typeof o !== "object") return {};
    const out: Record<string, PlanOverride> = {};
    for (const [k, v] of Object.entries(o)) if (v === "handled" || v === "na") out[k] = v;
    return out;
  } catch { return {}; }
}

planRouter.get("/plan", async (_req, res, next) => {
  try {
    const settings = await getStringSettings();
    const efMonthsFull = Math.max(1, Math.min(12, Number(settings["savings.efMonthsFull"]) || 3));
    const cushion = Math.max(0, Number(settings["savings.cushion"]) || 0);
    const efAccountId = settings["savings.emergencyAccountId"] || "";
    const overrides = parseOverrides(settings["plan.overrides"]);

    // ── budget set? ─────────────────────────────────────────────────────────
    const cats = await db.category.findMany({ where: { archived: false } });
    const hasBudget = cats.some((c) => Number(c.monthlyAmount.toString()) > 0);

    // ── essential monthly spend: avg of needs-class spend over the last 3 complete months ──
    const budgetAccts = await db.account.findMany({ where: { informational: false } });
    const ids = budgetAccts.map((a) => a.id);
    const txns = await db.transaction.findMany({
      where: { accountId: { in: ids } },
      select: { amount: true, category: true, categoryOverride: true, bookingDate: true },
    });
    const budgetTxns: BudgetTx[] = txns.map((t) => ({
      amount: Number(t.amount.toString()),
      category: effectiveCategory(t),         // effective category, per BudgetTx contract
      bookingDate: t.bookingDate,
    }));
    const needs = new Set(NEEDS_KEYS);
    const months: string[] = [];
    let mm = prevMonth(currentMonth());
    for (let k = 0; k < 3; k++) { months.push(mm); mm = prevMonth(mm); }
    const monthlyEssentials = months.map((month) => {
      const byCat = personalSpendByCategory(budgetTxns, month);
      return Object.entries(byCat).filter(([key]) => needs.has(key)).reduce((s, [, v]) => s + v, 0);
    }).filter((v) => v > 0);
    const essentialMonthly = averageMonthly(monthlyEssentials);

    // ── emergency-fund account balance ──────────────────────────────────────
    const sums = await manualTxnSums();
    const efAcct = efAccountId ? await db.account.findUnique({ where: { id: efAccountId }, include: { balances: true } }) : null;
    const efBalance = efAcct
      ? currentBalance(efAcct.source, efAcct.manualBalance != null ? Number(efAcct.manualBalance.toString()) : null,
          efAcct.balances.map((b) => ({ type: b.type, amount: Number(b.amount.toString()) })), efAcct.balanceType, sums.get(efAcct.id) ?? 0)
      : 0;

    // ── surplus (safe-to-payday − cushion); EF account excluded from spendable ──
    const spendRows = await db.account.findMany({
      where: { source: { in: ["BANK", "MANUAL"] }, informational: false },
      include: { balances: true },
    });
    const spendBalances = spendRows
      .filter((a) => a.id !== efAccountId)
      .map((a) => ({
        id: a.id,
        currentBalance: currentBalance(a.source, a.manualBalance != null ? Number(a.manualBalance.toString()) : null,
          a.balances.map((b) => ({ type: b.type, amount: Number(b.amount.toString()) })), a.balanceType, sums.get(a.id) ?? 0),
      }));
    const scheds = await db.recurringSchedule.findMany({ where: { status: { not: "ignored" } } });
    const fundingSchedules: FundingSchedule[] = scheds.map((s) => ({
      accountId: s.accountId, direction: s.direction === "in" ? ("in" as const) : ("out" as const),
      amount: Number(s.amount.toString()), cadence: s.cadence, dayOfMonth: s.dayOfMonth, nextDue: s.nextDue,
    }));
    const ym = new Date().toISOString().slice(0, 7); // matches accounts.ts /upcoming income tally (prod runs UTC)
    const credits = (await db.transaction.findMany({
      where: { amount: { gt: 0 }, bookingDate: { startsWith: ym } },
      select: { amount: true, category: true, categoryOverride: true, accountId: true },
    }))
      .filter((t) => effectiveCategory(t) === "income")
      .map((t) => ({ amount: Number(t.amount.toString()), accountId: t.accountId }));
    const income = tallyIncomeByAccount(credits);
    const funding = computeFunding(spendBalances, fundingSchedules, income, new Date());
    const spendableNow = funding.reduce((s, f) => s + f.balance, 0);
    const incomeIncoming = funding.reduce((s, f) => s + f.incomeIncoming, 0);
    const billsBeforePayday = funding.reduce((s, f) => s + f.committed, 0);
    const surplus = computeSurplus(spendableNow, incomeIncoming, billsBeforePayday, cushion);

    const efName = efAcct ? displayName(efAcct) : null;
    const { steps, current } = computePlanSteps({
      hasBudget, essentialMonthly, efTagged: !!efAcct, efBalance, efAccountName: efName,
      efMonthsFull, surplus, overrides,
    });

    const dto: PlanDTO = {
      essentialMonthly, surplus, current, steps,
      efAccount: efAcct ? { id: efAcct.id, name: efName!, balance: Math.round(efBalance * 100) / 100 } : null,
    };
    res.json(dto);
  } catch (e) { next(e); }
});

// Toggle a per-step escape hatch. value null clears the override (un-marks the step).
planRouter.patch("/plan/override", async (req, res, next) => {
  try {
    const body = z.object({
      step: z.enum(["budget", "ef_small", "pension", "ef_full", "invest"]),
      value: z.enum(["handled", "na"]).nullable(),
    }).parse(req.body);
    const settings = await getStringSettings();
    const overrides = parseOverrides(settings["plan.overrides"]);
    if (body.value === null) delete overrides[body.step];
    else overrides[body.step] = body.value;
    await setStringSetting("plan.overrides", JSON.stringify(overrides));
    res.json({ overrides });
  } catch (e) { next(e); }
});

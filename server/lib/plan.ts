import type { PlanStepDTO, PlanStepKey } from "../../shared/types.ts";

const round2 = (n: number) => Math.round(n * 100) / 100;
const gbp = (n: number) => `£${(Math.round(n * 100) / 100).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const pct = (have: number, target: number) => (target > 0 ? Math.min(100, Math.round((have / target) * 100)) : 0);

export function averageMonthly(values: number[]): number {
  if (values.length === 0) return 0;
  return round2(values.reduce((s, v) => s + v, 0) / values.length);
}

export function computeSurplus(spendableExEf: number, incomeIncoming: number, billsBeforePayday: number, cushion: number): number {
  return Math.max(0, round2(spendableExEf + incomeIncoming - billsBeforePayday - cushion));
}

export interface PlanInputs {
  hasBudget: boolean;
  essentialMonthly: number;
  efTagged: boolean;
  efBalance: number;
  efAccountName: string | null;
  efMonthsFull: number;
  expensiveDebt: { name: string; apr: number }[];
  unratedDebt: boolean;
  surplus: number;
}

export function computePlanSteps(i: PlanInputs): { steps: PlanStepDTO[]; current: PlanStepKey | null } {
  const canSizeEf = i.essentialMonthly > 0;
  const efDest = i.efTagged && i.efAccountName ? i.efAccountName : "your emergency fund";
  const efHint = (toGo: number) => `Move ${gbp(Math.min(i.surplus, toGo) || i.surplus)} to ${efDest}`;

  // Measured steps in UKPF order (pension omitted from measurement — see below).
  const smallTarget = i.essentialMonthly;        // 1× essentials
  const fullTarget = i.essentialMonthly * i.efMonthsFull;

  const measured: { key: PlanStepKey; done: boolean; build: (state: PlanStepDTO["state"]) => PlanStepDTO }[] = [
    {
      key: "budget", done: i.hasBudget,
      build: (state) => ({ key: "budget", state, title: "Budgeting", detail: i.hasBudget ? "Budgets set" : "Set your category budgets",
        progress: null, toGo: null, actionHint: state === "current" ? "Set a monthly amount on your categories" : null }),
    },
    {
      key: "ef_small", done: canSizeEf && i.efBalance >= smallTarget - 0.005,
      build: (state) => {
        const toGo = Math.max(0, round2(smallTarget - i.efBalance));
        return {
          key: "ef_small", state, title: "Emergency fund (1 month)",
          detail: !canSizeEf ? "Categorise your spending to size this" : !i.efTagged ? "Tag your emergency-fund account" : "1 month of essentials",
          progress: canSizeEf ? { have: round2(i.efBalance), target: round2(smallTarget), pct: pct(i.efBalance, smallTarget) } : null,
          toGo: canSizeEf ? toGo : null,
          actionHint: state === "current" && canSizeEf ? efHint(toGo) : null,
        };
      },
    },
    {
      key: "debt", done: i.expensiveDebt.length === 0 && !i.unratedDebt,
      build: (state) => ({
        key: "debt", state, title: "Clear expensive debt",
        detail: i.unratedDebt ? "Set the APR on your debts to check" : i.expensiveDebt.length ? i.expensiveDebt.map((d) => `${d.name} ${d.apr}% APR`).join(", ") : "No debt over 10% APR",
        progress: null, toGo: null,
        actionHint: state === "current" ? (i.unratedDebt ? "Add the interest rate to your debts" : i.expensiveDebt.length ? `Overpay ${i.expensiveDebt[0].name} (${i.expensiveDebt[0].apr}% APR)` : null) : null,
      }),
    },
    {
      key: "ef_full", done: canSizeEf && i.efBalance >= fullTarget - 0.005,
      build: (state) => {
        const toGo = Math.max(0, round2(fullTarget - i.efBalance));
        return {
          key: "ef_full", state, title: `Emergency fund (${i.efMonthsFull} months)`,
          detail: !canSizeEf ? "Categorise your spending to size this" : !i.efTagged ? "Tag your emergency-fund account" : `${i.efMonthsFull} months of essentials`,
          progress: canSizeEf ? { have: round2(i.efBalance), target: round2(fullTarget), pct: pct(i.efBalance, fullTarget) } : null,
          toGo: canSizeEf ? toGo : null,
          actionHint: state === "current" && canSizeEf ? efHint(toGo) : null,
        };
      },
    },
  ];

  const firstIncomplete = measured.findIndex((m) => !m.done);
  const current: PlanStepKey | null = firstIncomplete === -1 ? null : measured[firstIncomplete].key;

  const measuredSteps = measured.map((m, idx) => {
    const state: PlanStepDTO["state"] = m.done ? "done" : idx === firstIncomplete ? "current" : "locked";
    return m.build(state);
  });

  // pension sits between ef_small and debt; invest after ef_full. Both are non-blocking "coming" teasers in v1.
  const pension: PlanStepDTO = { key: "pension", state: "coming", title: "Get your pension match", detail: "Free money from your employer — coming soon", progress: null, toGo: null, actionHint: null };
  const invest: PlanStepDTO = { key: "invest", state: "coming", title: "Invest for the long term", detail: "LISA / S&S ISA — coming soon", progress: null, toGo: null, actionHint: null };

  const order: PlanStepKey[] = ["budget", "ef_small", "pension", "debt", "ef_full", "invest"];
  const byKey = new Map<PlanStepKey, PlanStepDTO>([...measuredSteps, pension, invest].map((s) => [s.key, s]));
  const steps = order.map((k) => byKey.get(k)!);
  return { steps, current };
}

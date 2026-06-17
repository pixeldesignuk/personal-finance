import type { PlanStepDTO, PlanStepKey, PlanStepState, PlanOverride } from "../../shared/types.ts";

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
  surplus: number;
  overrides: Record<string, PlanOverride>; // user escape hatches: step marked handled / N/A
}

type StepBase = Omit<PlanStepDTO, "overridden">;

export function computePlanSteps(i: PlanInputs): { steps: PlanStepDTO[]; current: PlanStepKey | null } {
  const canSizeEf = i.essentialMonthly > 0;
  const efDest = i.efTagged && i.efAccountName ? i.efAccountName : "your emergency fund";
  const efHint = (toGo: number) => `Move ${gbp(Math.min(i.surplus, toGo) || i.surplus)} to ${efDest}`;
  const ovDetail = (ov: PlanOverride) => (ov === "na" ? "Marked not applicable" : "Marked as handled");

  // Measured steps in UKPF order, focused on saving (debt management is out of
  // scope by design). Pension/invest are non-blocking teasers below.
  const smallTarget = i.essentialMonthly;        // 1× essentials
  const fullTarget = i.essentialMonthly * i.efMonthsFull;

  const measured: { key: PlanStepKey; naturalDone: boolean; build: (state: PlanStepState) => StepBase }[] = [
    {
      key: "budget", naturalDone: i.hasBudget,
      build: (state) => ({ key: "budget", state, title: "Budgeting", detail: i.hasBudget ? "Budgets set" : "Set your category budgets",
        progress: null, toGo: null, actionHint: state === "current" ? "Set a monthly amount on your categories" : null }),
    },
    {
      key: "ef_small", naturalDone: canSizeEf && i.efBalance >= smallTarget - 0.005,
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
      key: "ef_full", naturalDone: canSizeEf && i.efBalance >= fullTarget - 0.005,
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

  // A step is complete when naturally met OR the user marked it handled / N/A.
  const resolved = measured.map((m) => {
    const ov = i.overrides[m.key] ?? null;
    return { ...m, ov, done: m.naturalDone || ov != null };
  });
  const firstIncomplete = resolved.findIndex((m) => !m.done);
  const current: PlanStepKey | null = firstIncomplete === -1 ? null : resolved[firstIncomplete].key;

  const measuredSteps: PlanStepDTO[] = resolved.map((m, idx) => {
    const state: PlanStepState = m.done ? "done" : idx === firstIncomplete ? "current" : "locked";
    const base = m.build(state);
    // An override that stands in for a not-yet-met step gets the override label.
    const detail = m.ov && !m.naturalDone ? ovDetail(m.ov) : base.detail;
    return { ...base, detail, overridden: m.ov };
  });

  // pension (UKPF Step 3) sits after the initial EF; invest after the full EF.
  // Both are non-blocking "coming" teasers, but can be dismissed via an override.
  const teaser = (key: PlanStepKey, title: string, detail: string): PlanStepDTO => {
    const ov = i.overrides[key] ?? null;
    return { key, state: ov ? "done" : "coming", title, detail: ov ? ovDetail(ov) : detail, progress: null, toGo: null, actionHint: null, overridden: ov };
  };
  const pension = teaser("pension", "Get your pension match", "Free money from your employer — coming soon");
  const invest = teaser("invest", "Invest for the long term", "LISA / S&S ISA — coming soon");

  const order: PlanStepKey[] = ["budget", "ef_small", "pension", "ef_full", "invest"];
  const byKey = new Map<PlanStepKey, PlanStepDTO>([...measuredSteps, pension, invest].map((s) => [s.key, s]));
  const steps = order.map((k) => byKey.get(k)!);
  return { steps, current };
}

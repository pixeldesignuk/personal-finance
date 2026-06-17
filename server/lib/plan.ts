const round2 = (n: number) => Math.round(n * 100) / 100;

export function averageMonthly(values: number[]): number {
  if (values.length === 0) return 0;
  return round2(values.reduce((s, v) => s + v, 0) / values.length);
}

export function computeSurplus(spendableExEf: number, incomeIncoming: number, billsBeforePayday: number, cushion: number): number {
  return Math.max(0, round2(spendableExEf + incomeIncoming - billsBeforePayday - cushion));
}

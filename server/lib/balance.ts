export interface BalanceLike {
  type: string;
  amount: number;
}

const PREFERRED = ["interimAvailable", "expected", "closingBooked"];

export function currentBalance(
  source: "BANK" | "MANUAL",
  manualBalance: number | null,
  balances: BalanceLike[],
): number {
  if (source === "MANUAL") return manualBalance ?? 0;
  for (const t of PREFERRED) {
    const b = balances.find((x) => x.type === t);
    if (b) return b.amount;
  }
  return balances.length ? balances[0].amount : 0;
}

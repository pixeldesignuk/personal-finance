export interface BalanceLike {
  type: string;
  amount: number;
}

const PREFERRED = ["interimAvailable", "expected", "closingBooked"];

export function currentBalance(
  source: "BANK" | "MANUAL" | "INVESTMENT" | "ASSET" | "LIABILITY",
  manualBalance: number | null,
  balances: BalanceLike[],
  preferredType?: string | null,
): number {
  // Liabilities are entered as a positive amount owed but subtract from net worth.
  if (source === "LIABILITY") return -(manualBalance ?? 0);
  // Manual / investment / asset accounts carry their value in manualBalance.
  if (source !== "BANK") return manualBalance ?? 0;
  // An explicit per-account choice wins, when that type is present.
  if (preferredType) {
    const chosen = balances.find((b) => b.type === preferredType);
    if (chosen) return chosen.amount;
  }
  for (const t of PREFERRED) {
    const b = balances.find((x) => x.type === t);
    if (b) return b.amount;
  }
  return balances.length ? balances[0].amount : 0;
}

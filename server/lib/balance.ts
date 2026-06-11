export interface BalanceLike {
  type: string;
  amount: number;
}

// The portion of a bank balance that isn't the user's (held for others). Carved
// out of liquid/net worth wherever a BANK/MANUAL balance is summed.
export function excludedBalance(v: { toString(): string } | null | undefined): number {
  return v == null ? 0 : Number(v.toString());
}

const PREFERRED = ["interimAvailable", "expected", "closingBooked"];

export function currentBalance(
  source: "BANK" | "MANUAL" | "INVESTMENT" | "ASSET" | "LIABILITY",
  manualBalance: number | null,
  balances: BalanceLike[],
  preferredType?: string | null,
  txnSum = 0,
): number {
  // Liabilities are entered as a positive amount owed but subtract from net worth.
  if (source === "LIABILITY") return -(manualBalance ?? 0);
  // Cash accounts: the balance you set is a baseline; logged transactions adjust
  // it (a £18 spend reduces it). Investments/assets carry their value directly.
  if (source === "MANUAL") return (manualBalance ?? 0) + txnSum;
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

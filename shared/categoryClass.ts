// Single source of truth for the needs/wants/savings dimension (separate from a
// category's functional group). Imported by both web and server.
export type SpendClass = "needs" | "wants" | "savings";

const CLASS: Record<string, SpendClass> = {
  housing: "needs", utilities: "needs", groceries: "needs", transport: "needs",
  "family-care": "needs", "health-fitness": "needs", education: "needs", fees: "needs",
  "dining-out": "wants", shopping: "wants", entertainment: "wants", subscriptions: "wants",
  "travel-holidays": "wants", pets: "wants", "gifts-charities": "wants",
  "savings-investments": "savings", "debt-payments": "savings",
};

export const categoryClass = (key: string): SpendClass | null => CLASS[key] ?? null;
export const CLASS_TARGET: Record<SpendClass, number> = { needs: 50, wants: 30, savings: 20 };
export const NEEDS_KEYS: string[] = Object.keys(CLASS).filter((k) => CLASS[k] === "needs");

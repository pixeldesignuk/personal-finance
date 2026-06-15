import {
  Home, Receipt, ShoppingCart, Car, HeartPulse, Baby, GraduationCap,
  UtensilsCrossed, ShoppingBag, Repeat, Ticket, Plane, Gift, PawPrint,
  PiggyBank, CreditCard, Percent, Sparkles, Tag,
  type LucideIcon,
} from "lucide-react";

// A clean icon + colour per spending category, used by the v2 Budget page (fan
// segments and the category list). Keyed by the consolidated category `key`, with
// a per-group fallback, then a generic tag. No icon/colour is stored in the DB.
const ICONS: Record<string, LucideIcon> = {
  // Needs
  housing: Home, utilities: Receipt, groceries: ShoppingCart, transport: Car,
  "health-fitness": HeartPulse, "family-care": Baby, education: GraduationCap,
  // Wants
  "dining-out": UtensilsCrossed, shopping: ShoppingBag, subscriptions: Repeat,
  entertainment: Ticket, "travel-holidays": Plane, "gifts-charities": Gift, pets: PawPrint,
  // Savings & Debt
  "savings-investments": PiggyBank, "debt-payments": CreditCard, fees: Percent,
  uncategorised: Tag,
};

const GROUP_ICONS: Record<string, LucideIcon> = {
  "Home & Bills": Home,
  Living: ShoppingCart,
  "Family & Health": HeartPulse,
  Lifestyle: Sparkles,
  Money: PiggyBank,
};

// One distinct, hand-picked hue per known category — spread around the wheel so
// no two are identical (close shades/tints are fine). Unknown keys fall back to
// a full-spectrum hashed HSL, which is near-unique by construction.
const COLORS: Record<string, string> = {
  // Needs
  housing: "#FF8FB0", utilities: "#F2B14C", groceries: "#6FE3B0", transport: "#7DA3FF",
  "health-fitness": "#FF7E6B", "family-care": "#E27DD0", education: "#9CCB5A",
  // Wants
  "dining-out": "#F0883E", shopping: "#B58CFF", subscriptions: "#5FD0C5",
  entertainment: "#FFD166", "travel-holidays": "#56C2E6", "gifts-charities": "#FF9EC4", pets: "#C2A878",
  // Savings, Debt & misc
  "savings-investments": "#4FB477", "debt-payments": "#E5556E", fees: "#8C92AC",
  uncategorised: "#8a877e",
};
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

export function categoryMeta(key: string, group?: string | null): { Icon: LucideIcon; color: string } {
  const Icon = ICONS[key] ?? (group ? GROUP_ICONS[group] : undefined) ?? Tag;
  const h = hash(key);
  // Vary lightness slightly with a couple of hash bits so two unknown keys that
  // happen to share a hue are still distinguishable shades.
  const color = COLORS[key] ?? `hsl(${h % 360} 64% ${58 + ((h >> 9) % 14)}%)`;
  return { Icon, color };
}

export const REMAINDER_COLOR = "#5b5f66"; // the lumped "Other" fan segment

// The 50/30/20 classification — a SEPARATE dimension from the category's
// functional group. Categories are grouped by theme (Home & Bills, Living, …);
// this map rolls spending up into Needs / Wants / Savings at the transaction
// level for the 50/30/20 view. (Fees count as a Need — unavoidable cost.)
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

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
  Needs: Home,
  Wants: Sparkles,
  "Savings & Debt": PiggyBank,
};

// Vibrant, distinct hues that read well on the dark theme.
const PALETTE = ["#6FE3B0", "#7DA3FF", "#B58CFF", "#FF8FB0", "#F2B14C", "#5FD0C5", "#FF7E6B", "#9CCB5A", "#E27DD0", "#8FB0C9"];
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

export function categoryMeta(key: string, group?: string | null): { Icon: LucideIcon; color: string } {
  const Icon = ICONS[key] ?? (group ? GROUP_ICONS[group] : undefined) ?? Tag;
  const color = PALETTE[hash(key) % PALETTE.length];
  return { Icon, color };
}

export const REMAINDER_COLOR = "#5b5f66"; // the lumped "Other" fan segment

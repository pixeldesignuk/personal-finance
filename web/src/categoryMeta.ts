import {
  Home, Landmark, Zap, Flame, Droplets, Wifi, Smartphone,
  ShoppingCart, UtensilsCrossed, Fuel, User, Ticket,
  Car, Wrench, Hammer, ShoppingBag, Pill, Baby, Blocks, BookOpen, Gift, PawPrint, Plane,
  Cloud, Package, Repeat,
  Shirt, Dumbbell, Sparkles, HandHeart,
  PiggyBank, ShieldCheck, Banknote,
  Tag, Receipt, CalendarClock,
  type LucideIcon,
} from "lucide-react";

// A clean icon + colour per spending category, used by the v2 Budget page (fan
// segments and the category list). Keyed by the seeded category `key`, with a
// per-group fallback, then a generic tag. No icon/colour is stored in the DB.
const ICONS: Record<string, LucideIcon> = {
  rent: Home, "council-tax": Landmark, electricity: Zap, gas: Flame, water: Droplets, broadband: Wifi, mobile: Smartphone,
  groceries: ShoppingCart, "eating-out": UtensilsCrossed, fuel: Fuel, "mansoor-personal": User, "halima-personal": User, entertainment: Ticket,
  "car-finance": Car, "car-insurance": ShieldCheck, "car-tax": Car, "car-maintenance": Wrench, "home-maintenance": Hammer,
  "household-shopping": ShoppingBag, "medical-pharmacy": Pill, "baby-toddler": Baby, "kids-activities": Blocks,
  "islamic-education": BookOpen, gifts: Gift, pets: PawPrint, holidays: Plane,
  "cloud-services": Cloud, "amazon-prime": Package, subscriptions: Repeat,
  clothing: Shirt, fitness: Dumbbell, "self-care": Sparkles, "charity-sadaqah": HandHeart,
  "savings-investments": PiggyBank, "emergency-fund": ShieldCheck,
  "bank-fees": Landmark, "cash-atm": Banknote,
  uncategorised: Tag,
};

const GROUP_ICONS: Record<string, LucideIcon> = {
  "Monthly Bills": Receipt,
  Frequent: ShoppingCart,
  "Non-Monthly Expenses": CalendarClock,
  Subscriptions: Repeat,
  "Quality of Life": Sparkles,
  Savings: PiggyBank,
  Money: Banknote,
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

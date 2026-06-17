import { db } from "./db.ts";

// Known settings with defaults. Add new flags here — the settings drawer renders
// them generically by group.
export interface SettingDef {
  key: string;
  label: string;
  group: string;
  type: "boolean";
  default: boolean;
  hidden?: boolean; // not shown in the generic settings drawer (e.g. dashboard card toggles)
}

export const SETTING_DEFS: SettingDef[] = [
  { key: "networth.includeInvestments", label: "Include investments (ISA, crypto)", group: "Net worth", type: "boolean", default: true },
  { key: "networth.includeAssets", label: "Include assets (house, car)", group: "Net worth", type: "boolean", default: true },
  { key: "networth.includeDebts", label: "Subtract debts (mortgage, loans)", group: "Net worth", type: "boolean", default: true },
  // Dashboard card visibility — toggled via the dashboard's "Customize" mode, not
  // the settings drawer (hence `hidden`). Default on so the dashboard is complete.
  { key: "dashboard.show.hero", label: "Net worth & budget", group: "Dashboard", type: "boolean", default: true, hidden: true },
  { key: "dashboard.show.statIncome", label: "Income", group: "Dashboard", type: "boolean", default: true, hidden: true },
  { key: "dashboard.show.statSpent", label: "Spent", group: "Dashboard", type: "boolean", default: true, hidden: true },
  { key: "dashboard.show.statUpcoming", label: "Upcoming", group: "Dashboard", type: "boolean", default: true, hidden: true },
  { key: "dashboard.show.statNet", label: "Net this month", group: "Dashboard", type: "boolean", default: true, hidden: true },
  { key: "dashboard.show.goalDebt", label: "Debt goal", group: "Dashboard", type: "boolean", default: true, hidden: true },
  { key: "dashboard.show.goalSavings", label: "Savings goal", group: "Dashboard", type: "boolean", default: true, hidden: true },
  { key: "dashboard.show.upcoming", label: "Upcoming bills & income", group: "Dashboard", type: "boolean", default: true, hidden: true },
  { key: "dashboard.show.spendingCategories", label: "Where it went", group: "Dashboard", type: "boolean", default: true, hidden: true },
  { key: "dashboard.show.budgetGroups", label: "Budget by group", group: "Dashboard", type: "boolean", default: true, hidden: true },
  { key: "dashboard.show.statSavingsRate", label: "Savings rate", group: "Dashboard", type: "boolean", default: true, hidden: true },
  { key: "dashboard.show.topMerchants", label: "Top merchants", group: "Dashboard", type: "boolean", default: true, hidden: true },
  { key: "dashboard.show.recentActivity", label: "Recent activity", group: "Dashboard", type: "boolean", default: true, hidden: true },
  // Per-card view option: render Recent activity as the Transactions-page card grid
  // instead of the default list rows. Off by default (keeps the compact list).
  { key: "dashboard.recentActivity.cards", label: "Recent activity · card view", group: "Dashboard", type: "boolean", default: false, hidden: true },
  { key: "dashboard.show.cashflow", label: "Spending", group: "Dashboard", type: "boolean", default: true, hidden: true },
  { key: "dashboard.show.balances", label: "Balances by account", group: "Dashboard", type: "boolean", default: true, hidden: true },
  // Budget hero card — configurable parts (toggled via the card's gear in Customize mode).
  { key: "dashboard.hero.showTitle", label: "Budget · title", group: "Dashboard", type: "boolean", default: true, hidden: true },
  { key: "dashboard.hero.showBar", label: "Budget · progress bar", group: "Dashboard", type: "boolean", default: true, hidden: true },
  { key: "dashboard.hero.showBreakdown", label: "Budget · breakdown line", group: "Dashboard", type: "boolean", default: true, hidden: true },
  { key: "dashboard.hero.showBills", label: "Budget · upcoming bills", group: "Dashboard", type: "boolean", default: true, hidden: true },
];

const DEFAULTS: Record<string, boolean> = Object.fromEntries(SETTING_DEFS.map((d) => [d.key, d.default]));

// String-valued settings (the boolean store can't hold these). Each has either an
// allow-list or a validate predicate to prevent unknown values from persisting.
export interface StringSettingDef { key: string; default: string; allowed?: string[]; validate?: (v: string) => boolean }
export const STRING_SETTING_DEFS: StringSettingDef[] = [
  { key: "dashboard.hero.figure", default: "left", allowed: ["left", "spent", "networth", "net"] },
  { key: "savings.emergencyAccountId", default: "", validate: (v) => v === "" || v.length <= 64 },
  { key: "savings.efMonthsFull", default: "3", validate: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= 12; } },
  { key: "savings.cushion", default: "100", validate: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 100000; } },
];
const STRING_DEFAULTS: Record<string, string> = Object.fromEntries(STRING_SETTING_DEFS.map((d) => [d.key, d.default]));

export async function getStringSettings(): Promise<Record<string, string>> {
  const keys = new Set(STRING_SETTING_DEFS.map((d) => d.key));
  const rows = await db.setting.findMany();
  const stored: Record<string, string> = {};
  for (const r of rows) if (keys.has(r.key)) stored[r.key] = r.value;
  return { ...STRING_DEFAULTS, ...stored };
}

// Returns true if the key/value was a known, valid string setting (and was stored).
export async function setStringSetting(key: string, value: string): Promise<boolean> {
  const def = STRING_SETTING_DEFS.find((d) => d.key === key);
  if (!def) return false;
  if (def.allowed && !def.allowed.includes(value)) return false;
  if (def.validate && !def.validate(value)) return false;
  await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  return true;
}

// Current values merged over defaults.
export async function getSettings(): Promise<Record<string, boolean>> {
  const rows = await db.setting.findMany();
  const stored: Record<string, boolean> = {};
  for (const r of rows) stored[r.key] = r.value === "true";
  return { ...DEFAULTS, ...stored };
}

export async function setSetting(key: string, value: boolean): Promise<void> {
  await db.setting.upsert({ where: { key }, create: { key, value: String(value) }, update: { value: String(value) } });
}

// Dashboard section order. Stored as a JSON array of block keys in a single
// Setting row. Default order is the canonical layout; getDashboardOrder always
// returns every known key (stored order first, then any missing keys appended,
// unknown keys dropped) so a stale stored order can't hide a block.
export const DASHBOARD_BLOCKS = ["hero", "stats", "goals", "recentActivity", "upcoming", "spending", "topMerchants", "cashflow", "balances"] as const;
const ORDER_KEY = "dashboard.order";

export async function getDashboardOrder(): Promise<string[]> {
  const row = await db.setting.findUnique({ where: { key: ORDER_KEY } });
  let stored: string[] = [];
  if (row) { try { const p = JSON.parse(row.value); if (Array.isArray(p)) stored = p.filter((k): k is string => typeof k === "string"); } catch { /* ignore */ } }
  const known = new Set<string>(DASHBOARD_BLOCKS);
  const ordered = stored.filter((k) => known.has(k));
  for (const k of DASHBOARD_BLOCKS) if (!ordered.includes(k)) ordered.push(k);
  return ordered;
}

export async function setDashboardOrder(order: string[]): Promise<void> {
  const known = new Set<string>(DASHBOARD_BLOCKS);
  const clean = order.filter((k) => known.has(k));
  await db.setting.upsert({ where: { key: ORDER_KEY }, create: { key: ORDER_KEY, value: JSON.stringify(clean) }, update: { value: JSON.stringify(clean) } });
}

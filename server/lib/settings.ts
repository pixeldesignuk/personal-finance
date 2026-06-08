import { db } from "./db.ts";

// Known settings with defaults. Add new flags here — the settings drawer renders
// them generically by group.
export interface SettingDef {
  key: string;
  label: string;
  group: string;
  type: "boolean";
  default: boolean;
}

export const SETTING_DEFS: SettingDef[] = [
  { key: "networth.includeInvestments", label: "Include investments (ISA, crypto)", group: "Net worth", type: "boolean", default: true },
  { key: "networth.includeAssets", label: "Include assets (house, car)", group: "Net worth", type: "boolean", default: true },
  { key: "networth.includeDebts", label: "Subtract debts (mortgage, loans)", group: "Net worth", type: "boolean", default: true },
];

const DEFAULTS: Record<string, boolean> = Object.fromEntries(SETTING_DEFS.map((d) => [d.key, d.default]));

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

export interface Rule {
  matchText: string;
  categoryKey: string | null;
  personKey: string | null;
  priority: number;
}

export function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function applyRules(text: string, rules: Rule[]): { categoryKey?: string; personKey?: string } {
  const hay = text.toLowerCase();
  const ordered = [...rules].sort((a, b) => b.priority - a.priority);
  let categoryKey: string | undefined;
  let personKey: string | undefined;
  for (const r of ordered) {
    if (!r.matchText || !hay.includes(r.matchText.toLowerCase())) continue;
    if (categoryKey === undefined && r.categoryKey) categoryKey = r.categoryKey;
    if (personKey === undefined && r.personKey) personKey = r.personKey;
    if (categoryKey !== undefined && personKey !== undefined) break;
  }
  return { categoryKey, personKey };
}

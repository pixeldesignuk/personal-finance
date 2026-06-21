// Pure helpers for the auto-categorisation flow. No I/O — unit-tested.

export interface Pick {
  id: string;
  categoryKey: string;
}

// Parse the JSON Gemini returns into picks. Accepts either a bare array
// `[{id, categoryKey}]` or an object wrapping one as `{items: [...]}`.
// Returns [] for anything malformed (the LLM occasionally adds stray text).
export function parsePicks(jsonText: string): Pick[] {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return [];
  }
  const arr = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)
      ? (data as { items: unknown[] }).items
      : [];
  const picks: Pick[] = [];
  for (const el of arr) {
    if (
      el && typeof el === "object" &&
      typeof (el as { id?: unknown }).id === "string" &&
      typeof (el as { categoryKey?: unknown }).categoryKey === "string"
    ) {
      picks.push({ id: (el as Pick).id, categoryKey: (el as Pick).categoryKey });
    }
  }
  return picks;
}

// Keep only picks whose categoryKey is a real category. Guards against the
// LLM inventing keys. Returns a Map of id -> categoryKey.
export function mapPicks(picks: Pick[], validKeys: Set<string>): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of picks) {
    if (p && typeof p.id === "string" && validKeys.has(p.categoryKey)) m.set(p.id, p.categoryKey);
  }
  return m;
}

// Choose a receipt's category. The AI suggestion is made with the full receipt
// context (merchant *and* the line items), so it outranks the blunt merchant-name
// rules — a Tesco fuel receipt must not be filed as groceries just because a
// "tesco → groceries" rule exists. The rule category is only a fallback for when
// the AI is unsure (null), and "uncategorised" when neither has an opinion.
export function chooseReceiptCategory(
  aiCategory: string | null | undefined,
  ruleCategory: string | null | undefined,
): string {
  return aiCategory || ruleCategory || "uncategorised";
}

// Derive a stable merchant token to use as the matchText of a learned rule,
// from a clean name field (merchantName/creditorName). Lowercases, drops
// punctuation and pure-number tokens (store/branch numbers), keeps up to the
// first three words so it stays a substring of future transactions' text.
// Returns null when there's nothing meaningful to learn from.
export function merchantToken(name: string | null | undefined): string | null {
  if (!name) return null;
  const cleaned = name.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const words = cleaned.split(" ").filter((w) => w && !/^\d+$/.test(w));
  if (!words.length) return null;
  const token = words.slice(0, 3).join(" ");
  // Keep tokens of >= 2 chars so short real brands survive (O2, EE, BP); only a
  // lone single character is too thin to learn from.
  return token.length < 2 ? null : token;
}

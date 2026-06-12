export interface ParsedExpense {
  amount: number;
  category: string;
  merchant: string;
  date: string;
}

// Free, no-API text parser: pulls the first amount, defaults to a spend
// (negative). A leading "+" marks income. New entries land Uncategorised (the
// user picks a real category via the inline buttons). e.g. "£12.50 lunch".
export function parseTextExpense(text: string): ParsedExpense | null {
  const m = text.match(/([+-])?\s*[£$]?\s*(\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  const value = Number(m[2]);
  if (!Number.isFinite(value) || value === 0) return null;
  const amount = m[1] === "+" ? value : -value;
  const note = text.replace(m[0], "").trim();
  return { amount, category: amount > 0 ? "income" : "uncategorised", merchant: note, date: "" };
}

export interface NormalizedTxn {
  amount: string;
  category: string;
  note: string;
  date: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeParsed(p: ParsedExpense, todayISO: string): NormalizedTxn {
  const category = p.category && p.category.trim() ? p.category : "uncategorised";
  let amount = Number.isFinite(p.amount) ? p.amount : 0;
  // Spends are negative; only income may be positive.
  if (category !== "income" && amount > 0) amount = -amount;
  const date = DATE_RE.test(p.date) ? p.date : todayISO;
  return { amount: amount.toFixed(2), category, note: (p.merchant ?? "").trim(), date };
}

export function isAllowed(chatId: number | undefined, allowed: string | undefined): boolean {
  return !!chatId && !!allowed && String(chatId) === allowed;
}

export function confirmText(t: NormalizedTxn): string {
  const n = Number(t.amount);
  const money = `${n < 0 ? "-" : ""}£${Math.abs(n).toFixed(2)}`;
  // `category` here is the display NAME (e.g. "Pets"); account is implied (Cash).
  return `Logged ${money} · ${t.category}${t.note ? ` · ${t.note}` : ""}`;
}

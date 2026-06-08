import { CATEGORIES } from "./categorize.ts";

export interface ParsedExpense {
  amount: number;
  category: string;
  merchant: string;
  date: string;
}

export interface NormalizedTxn {
  amount: string;
  category: string;
  note: string;
  date: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeParsed(p: ParsedExpense, todayISO: string): NormalizedTxn {
  const category = CATEGORIES.includes(p.category) ? p.category : "other";
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
  return `Logged ${money} · ${t.category}${t.note ? ` · ${t.note}` : ""} → Cash`;
}

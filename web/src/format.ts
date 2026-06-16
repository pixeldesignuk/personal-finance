// Money display formatting. Accepts a number or a decimal string and renders it
// with thousands separators and exactly 2 decimals, e.g. 4539.36 -> "4,539.36",
// -12.5 -> "-12.50". Falls back to the raw input if it isn't a finite number.
export function formatMoney(value: number | string, round = false): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("en-GB", {
    minimumFractionDigits: round ? 0 : 2,
    maximumFractionDigits: round ? 0 : 2,
  });
}

// A date string ("YYYY-MM-DD") shown as a relative day when recent (Today /
// Yesterday / 2 days ago), reverting to an absolute date once older than 2 days.
// (Bank transactions carry a date only — no time of day.)
export function relativeDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startToday.getTime() - startDate.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays === 2) return "2 days ago";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

// With a "£" prefix (sign kept on the number, e.g. "£1,234.50", "-£5.00").
export function formatGBP(value: number | string, round = false): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return `£${value}`;
  return n < 0 ? `-£${formatMoney(-n, round)}` : `£${formatMoney(n, round)}`;
}

// The symbol for a currency code (defaults to £). Single source of truth — the
// pages used to each redefine this inline.
export function ccySymbol(currency: string | null | undefined): string {
  switch (currency) {
    case "USD": return "$";
    case "EUR": return "€";
    default: return "£";
  }
}

// Like formatGBP but honouring the given currency, e.g. ("12.5","USD") -> "$12.50".
export function formatCcy(value: number | string, currency?: string | null, round = false): string {
  const n = typeof value === "string" ? Number(value) : value;
  const sym = ccySymbol(currency);
  if (!Number.isFinite(n)) return `${sym}${value}`;
  return n < 0 ? `-${sym}${formatMoney(-n, round)}` : `${sym}${formatMoney(n, round)}`;
}

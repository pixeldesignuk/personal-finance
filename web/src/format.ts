// Money display formatting. Accepts a number or a decimal string and renders it
// with thousands separators and exactly 2 decimals, e.g. 4539.36 -> "4,539.36",
// -12.5 -> "-12.50". Falls back to the raw input if it isn't a finite number.
export function formatMoney(value: number | string): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// With a "£" prefix (sign kept on the number, e.g. "£1,234.50", "-£5.00").
export function formatGBP(value: number | string): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return `£${value}`;
  return n < 0 ? `-£${formatMoney(-n)}` : `£${formatMoney(n)}`;
}

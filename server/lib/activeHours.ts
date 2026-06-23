// Whether "now" falls inside the daily active window for background sync, in a
// fixed timezone. Prod runs UTC (see CLAUDE.md), so we must derive the hour from
// a known zone — never the server's local clock — or the window drifts by an
// hour under BST and is plain wrong on a UTC box.

export const SYNC_TIMEZONE = "Europe/London";

// Hour-of-day (0–23) for `date` as seen in `timeZone`.
export function hourInZone(date: Date, timeZone: string = SYNC_TIMEZONE): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false }).format(date);
  return Number(h) % 24; // some ICU builds render midnight as "24"
}

// Active when startHour <= hour < endHour (e.g. 7..23 = daytime). If startHour
// >= endHour the window is treated as wrapping past midnight (active outside
// [endHour, startHour)); startHour === endHour means always-on.
export function isWithinActiveHours(
  date: Date,
  startHour: number,
  endHour: number,
  timeZone: string = SYNC_TIMEZONE,
): boolean {
  const h = hourInZone(date, timeZone);
  if (startHour === endHour) return true;
  if (startHour < endHour) return h >= startHour && h < endHour;
  return h >= startHour || h < endHour;
}

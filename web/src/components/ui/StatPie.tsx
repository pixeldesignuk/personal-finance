import type { CSSProperties } from "react";

// A small two-slice donut for a stat tile: a jade arc of `value`% (e.g. share of
// income saved) with the remainder in coral. Pure CSS (conic-gradient + mask).
export function StatPie({ value, size = 46, fill = false }: { value: number; size?: number; fill?: boolean }) {
  const p = Math.max(0, Math.min(100, value));
  // `fill` mode drops the fixed px size so CSS can size it to its container
  // (e.g. the full height of a stat tile).
  const style: CSSProperties = fill
    ? ({ "--p": p } as CSSProperties)
    : ({ width: size, height: size, "--p": p } as CSSProperties);
  return (
    <span
      className={`stat-pie${fill ? " is-fill" : ""}`}
      style={style}
      role="img"
      aria-label={`${Math.round(p)}% saved`}
    />
  );
}

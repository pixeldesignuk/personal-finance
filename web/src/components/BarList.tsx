import type { ReactNode } from "react";
import { formatGBP } from "../format.ts";

export interface BarItem { key: string; label: string; value: number; sub?: string; leading?: ReactNode; color?: string }

// A compact horizontal bar list — values scaled to the largest. Good for "top
// merchants / categories" where a table reads as a wall of numbers.
export function BarList({ items }: { items: BarItem[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="barlist">
      {items.map((i) => (
        <div className="barlist-row" key={i.key}>
          <div className="barlist-head">
            {i.leading}
            <span className="barlist-label">{i.label}</span>
            {i.sub && <span className="muted barlist-sub">{i.sub}</span>}
            <span className="num barlist-val">{formatGBP(i.value)}</span>
          </div>
          <div className="barlist-track"><i style={{ width: `${(i.value / max) * 100}%`, background: i.color }} /></div>
        </div>
      ))}
      {items.length === 0 && <p className="muted">No data yet.</p>}
    </div>
  );
}

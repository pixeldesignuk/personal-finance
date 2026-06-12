import type { ReactNode } from "react";

// A single figure in the stat grid: label · big value (+ optional % badge) ·
// optional breakdown bar · optional delta line. Wrap a few in `<div className="grid">`.
export function Stat({ label, value, valueTone, badge, side, bar, delta, deltaTone = "muted" }: {
  label: ReactNode;
  value: ReactNode;
  valueTone?: "pos" | "neg";
  badge?: ReactNode;          // small pill beside the value (e.g. "67%")
  side?: ReactNode;           // full-height figure to the right of the column (e.g. a donut)
  bar?: ReactNode;            // a breakdown bar (e.g. <div className="progress …">)
  delta?: ReactNode;
  deltaTone?: "muted" | "pos" | "neg" | "warn-text";
}) {
  return (
    <div className="card stat">
      <div className="stat-inner">
        <div className="stat-body">
          <span className="label">{label}</span>
          <span className="stat-main">
            <span className={`value${valueTone ? ` ${valueTone}` : ""}`}>{value}</span>
            {badge != null && <span className="stat-badge">{badge}</span>}
          </span>
          {bar}
          {delta != null && <span className={`delta ${deltaTone}`}>{delta}</span>}
        </div>
        {side != null && <span className="stat-side">{side}</span>}
      </div>
    </div>
  );
}

import type { ReactNode } from "react";

// A single figure in the stat grid: label · big value · optional delta line.
// Wrap a few of these in `<div className="grid">`.
export function Stat({ label, value, valueTone, delta, deltaTone = "muted" }: {
  label: ReactNode;
  value: ReactNode;
  valueTone?: "pos" | "neg";
  delta?: ReactNode;
  deltaTone?: "muted" | "pos" | "neg" | "warn-text";
}) {
  return (
    <div className="card stat">
      <span className="label">{label}</span>
      <span className={`value${valueTone ? ` ${valueTone}` : ""}`}>{value}</span>
      {delta != null && <span className={`delta ${deltaTone}`}>{delta}</span>}
    </div>
  );
}

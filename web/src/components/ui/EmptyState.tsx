import type { ReactNode } from "react";

// A standalone "nothing here yet" card. For empties *inside* an existing card
// (e.g. under a table) use `<p className="empty">…</p>` directly instead.
export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="card"><p className="empty">{children}</p></div>;
}

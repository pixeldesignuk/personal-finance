import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { AccountHealthDTO } from "../../../shared/types.ts";

// A drawer (portalled to document.body, per the transformed-ancestor overlay
// gotcha) showing an account's health verdict, the reasons, and recommendations.
export function AccountHealthPanel({ name, health, viewTxnsTo, onClose }: {
  name: string;
  health: AccountHealthDTO;
  viewTxnsTo: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer health-panel" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <span className="sheet-title">{name}</span>
          <button className="btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="drawer-body">
          <div className={`health-verdict ${health.color}`}>
            <span className="health-dot" />
            {health.headline}
          </div>
          <ul className="health-checks">
            {health.checks.map((c) => (
              <li key={c.key} className={`health-check ${c.severity}`}>
                <span className="health-check-title">{c.title}</span>
                <span className="health-check-why">{c.why}</span>
                {c.recommendation && <span className="health-check-rec">{c.recommendation}</span>}
              </li>
            ))}
          </ul>
          <Link className="btn-sm health-view-txns" to={viewTxnsTo} onClick={onClose}>View transactions</Link>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api.ts";
import { formatGBP } from "../format.ts";

// The always-present "Your plan" anchor: where you are on budget → save → invest.
// Pure progress (no actions) — actions live in the NeedsYou inbox.
export function PlanProgressCard() {
  const { data } = useQuery({ queryKey: ["plan"], queryFn: () => api.plan() });
  if (!data) return null;

  const current = data.current ? data.steps.find((s) => s.key === data.current) : null;

  // Nothing set up yet → a slim set-up prompt instead of the stepper.
  if (!current) {
    return (
      <Link to="/savings" className="card planprog-card planprog-card-empty">
        <span className="planprog-title">Set up your plan</span>
        <span className="planprog-go">Start →</span>
      </Link>
    );
  }

  const stepNo = data.steps.findIndex((s) => s.key === data.current) + 1;
  const total = data.steps.length;
  const pct = current.progress?.pct ?? 0;
  return (
    <Link to="/savings" className="card planprog-card">
      <div className="planprog-row">
        <span className="planprog-title">{current.title}</span>
        <span className="planprog-stepno muted">Step {stepNo} of {total}</span>
      </div>
      {current.progress ? (
        <>
          <div className="planprog-bar" aria-hidden><i style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} /></div>
          <span className="planprog-sub muted">
            {formatGBP(current.progress.have)} of {formatGBP(current.progress.target)} · {pct}%
          </span>
        </>
      ) : (
        <span className="planprog-sub muted">In progress</span>
      )}
    </Link>
  );
}

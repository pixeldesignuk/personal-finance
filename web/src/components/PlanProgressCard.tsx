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
      <Link to="/savings" className="card plan-card plan-card-empty">
        <span className="plan-card-title">Set up your plan</span>
        <span className="plan-card-go">Start →</span>
      </Link>
    );
  }

  const pct = current.progress?.pct ?? 0;
  return (
    <Link to="/savings" className="card plan-card">
      <div className="plan-card-row">
        <span className="plan-card-title">{current.title}</span>
        {current.progress && <span className="plan-card-pct num">{pct}%</span>}
      </div>
      <div className="plan-steps" aria-hidden>
        {data.steps.map((s) => (
          <span key={s.key} className={`plan-step is-${s.key === data.current ? "current" : s.state}`} />
        ))}
      </div>
      {current.progress && (
        <span className="plan-card-sub muted">
          {formatGBP(current.progress.have)} of {formatGBP(current.progress.target)}
        </span>
      )}
    </Link>
  );
}

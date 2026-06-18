import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api.ts";
import { formatGBP } from "../format.ts";

// The always-present "Your plan" anchor. Calm by design (Monarch / Rocket Money
// pattern): one focal progress bar for the current step + a single context line,
// with a small dot indicator for journey position. The full named roadmap lives
// on the Savings page (tap through).
export function PlanProgressCard() {
  const { data } = useQuery({ queryKey: ["plan"], queryFn: () => api.plan() });
  if (!data) return null;

  const current = data.current ? data.steps.find((s) => s.key === data.current) : null;

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
        <span className="planprog-title">Your plan</span>
        <span className="planprog-dots" aria-hidden>
          {data.steps.map((s) => (
            <span key={s.key} className={`planprog-dot is-${s.key === data.current ? "current" : s.state === "done" ? "done" : "upcoming"}`} />
          ))}
        </span>
      </div>
      {current.progress ? (
        <>
          <div className="planprog-bar" aria-hidden><i style={{ width: `${Math.min(100, Math.max(3, pct))}%` }} /></div>
          <span className="planprog-sub muted">
            Step {stepNo} of {total} · {current.title} · {formatGBP(current.progress.have)} of {formatGBP(current.progress.target)}
          </span>
        </>
      ) : (
        <span className="planprog-sub muted">Step {stepNo} of {total} · {current.title}</span>
      )}
    </Link>
  );
}

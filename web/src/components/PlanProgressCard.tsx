import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { api } from "../api.ts";
import { formatGBP } from "../format.ts";

// "Your plan" anchor — a numbered stepper (done = check, current emphasised,
// future hollow) for where you are on budget→save→invest, above the current
// step's focal progress bar + amount. Modelled on Deel/Mercedes steppers +
// Quicken/Rocket Money goal bars. Full named roadmap lives on /savings.
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

  const currentIdx = data.steps.findIndex((s) => s.key === data.current);
  const pct = current.progress?.pct ?? 0;

  return (
    <Link to="/savings" className="card planprog-card">
      <div className="planprog-row">
        <span className="planprog-title">Your plan</span>
        <span className="planprog-stepno muted">Step {currentIdx + 1} of {data.steps.length}</span>
      </div>
      <ol className="planprog-stepper" aria-hidden>
        {data.steps.map((s, i) => {
          const state = s.key === data.current ? "current" : s.state === "done" ? "done" : "upcoming";
          return (
            <li key={s.key} className={`planprog-pstep is-${state}`}>
              <span className="planprog-pnode">{state === "done" ? <Check size={12} strokeWidth={3} /> : i + 1}</span>
            </li>
          );
        })}
      </ol>
      {current.progress ? (
        <div className="planprog-current">
          <div className="planprog-clabel">
            <span className="planprog-cname">{current.title}</span>
            <span className="planprog-camt muted">{formatGBP(current.progress.have)} of {formatGBP(current.progress.target)}</span>
          </div>
          <div className="planprog-bar"><i style={{ width: `${Math.min(100, Math.max(3, pct))}%` }} /></div>
        </div>
      ) : (
        <span className="planprog-sub muted">{current.title}</span>
      )}
    </Link>
  );
}

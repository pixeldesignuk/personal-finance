import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { api } from "../api.ts";
import { formatGBP } from "../format.ts";

// Short rail labels for the budget→save→invest roadmap (the DTO titles are long).
const SHORT_LABEL: Record<string, string> = {
  budget: "Budget",
  ef_small: "Starter fund",
  pension: "Pension",
  ef_full: "Full fund",
  invest: "Invest",
};

// The always-present "Your plan" anchor: a snapshot of the whole journey — which
// steps are done, where you are now, what's still ahead — plus the current
// step's target. A roadmap, not a progress meter.
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

  return (
    <Link to="/savings" className="card planprog-card">
      <div className="planprog-row">
        <span className="planprog-title">Your plan</span>
        <span className="planprog-stepno muted">Step {stepNo} of {total}</span>
      </div>
      <ol className="planprog-rail" aria-hidden>
        {data.steps.map((s) => {
          const state = s.key === data.current ? "current" : s.state === "done" ? "done" : "upcoming";
          return (
            <li key={s.key} className={`planprog-node is-${state}`}>
              <span className="planprog-dot">{state === "done" && <Check size={11} strokeWidth={3} />}</span>
              <span className="planprog-label">{SHORT_LABEL[s.key] ?? s.title}</span>
            </li>
          );
        })}
      </ol>
      {current.progress ? (
        <span className="planprog-sub muted">
          {current.title} · {formatGBP(current.progress.have)} of {formatGBP(current.progress.target)}
        </span>
      ) : (
        <span className="planprog-sub muted">{current.title}</span>
      )}
    </Link>
  );
}

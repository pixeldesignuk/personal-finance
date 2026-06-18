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

// "Your plan" anchor — a labeled journey stepper (done = green check, current
// step bold in green, future hollow) above the current step's focal amount +
// progress bar. Modelled on order-status steppers + Satispay's goal progress.
// Full named roadmap lives on /savings.
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

  const pct = current.progress?.pct ?? 0;

  return (
    <Link to="/savings" className="card planprog-card">
      <span className="planprog-title">Your plan</span>
      <ol className="planprog-stepper" aria-hidden>
        {data.steps.map((s) => {
          const state = s.key === data.current ? "current" : s.state === "done" ? "done" : "upcoming";
          return (
            <li key={s.key} className={`planprog-pstep is-${state}`}>
              <span className="planprog-pnode">{state === "done" && <Check size={11} strokeWidth={3.2} />}</span>
              <span className="planprog-plabel">{SHORT_LABEL[s.key] ?? s.title}</span>
            </li>
          );
        })}
      </ol>
      {current.progress ? (
        <div className="planprog-current">
          <span className="planprog-camt"><b>{formatGBP(current.progress.have)}</b> of {formatGBP(current.progress.target)} · {pct}%</span>
          <div className="planprog-bar"><i style={{ width: `${Math.min(100, Math.max(3, pct))}%` }} /></div>
        </div>
      ) : (
        <span className="planprog-sub muted">{current.title}</span>
      )}
    </Link>
  );
}

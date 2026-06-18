import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { api } from "../api.ts";
import { formatGBP } from "../format.ts";
import type { PlanStepKey } from "../../../shared/types.ts";

// Short rail labels for the budget→save→invest roadmap (the DTO titles are long).
const SHORT_LABEL: Record<PlanStepKey, string> = {
  budget: "Budget",
  ef_small: "Starter fund",
  pension: "Pension",
  ef_full: "Full fund",
  invest: "Invest",
};

// Contextual next-action per current step. The app tracks money (no transfers),
// so the action is navigational, not a real "add money" button.
const STEP_CTA: Record<PlanStepKey, { label: string; to: string }> = {
  budget: { label: "Set up budgets", to: "/budgets" },
  ef_small: { label: "Open savings", to: "/savings" },
  ef_full: { label: "Open savings", to: "/savings" },
  pension: { label: "See plan", to: "/savings" },
  invest: { label: "See plan", to: "/savings" },
};

// "Your plan" command-center card. Two columns: left = the focal current step
// (big amount, thick bar, "to go", contextual action); right = a quiet vertical
// journey rail showing where you are across the 5 steps. Money is the hero; the
// journey is demoted context. Grounded in Alan / Acorns / Quicken (Mobbin).
// Full named roadmap lives on /savings (PlanFlowchart).
export function PlanProgressCard() {
  const { data } = useQuery({ queryKey: ["plan"], queryFn: () => api.plan() });
  if (!data) return null;

  const current = data.current ? data.steps.find((s) => s.key === data.current) : null;

  if (!current) {
    return (
      <Link to="/savings" className="card planprog-card planprog-empty">
        <span className="planprog-eyebrow">Your plan</span>
        <span className="planprog-empty-title">Set up your plan</span>
        <span className="planprog-empty-go">Start →</span>
      </Link>
    );
  }

  const pct = current.progress?.pct ?? 0;
  const cta = STEP_CTA[current.key];
  const nudge = data.surplus > 0 ? current.actionHint : null;

  return (
    <div className="card planprog-card">
      {/* Left — focal action */}
      <div className="planprog-main">
        <span className="planprog-eyebrow">{current.title}</span>

        {current.progress ? (
          <>
            <div className="planprog-amount">
              <b>{formatGBP(current.progress.have)}</b>
              <span className="planprog-of">
                of {formatGBP(current.progress.target)}
                {current.toGo != null && current.toGo > 0 && ` · ${formatGBP(current.toGo)} to go`}
              </span>
            </div>
            <div className="planprog-bar">
              <i style={{ width: `${Math.min(100, Math.max(3, pct))}%` }} />
              <span className="planprog-pct">{pct}%</span>
            </div>
          </>
        ) : (
          current.detail && <p className="planprog-detail">{current.detail}</p>
        )}

        {nudge && <p className="planprog-nudge">{nudge}</p>}

        <Link to={cta.to} className="planprog-cta">{cta.label} →</Link>
      </div>

      {/* Right — quiet journey rail */}
      <div className="planprog-rail">
        <Link to="/savings" className="planprog-railhead">Your plan</Link>
        <ol className="planprog-rsteps">
          {data.steps.map((s) => {
            const state = s.key === data.current ? "current" : s.state === "done" ? "done" : "upcoming";
            return (
              <li key={s.key} className={`planprog-rstep is-${state}`}>
                <span className="planprog-rnode">{state === "done" && <Check size={11} strokeWidth={3.4} />}</span>
                <span className="planprog-rlabel">{SHORT_LABEL[s.key] ?? s.title}</span>
                {state === "current" && <span className="planprog-rhere">you</span>}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

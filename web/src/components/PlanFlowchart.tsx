import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Lock } from "lucide-react";
import { api } from "../api.ts";
import { formatGBP } from "../format.ts";

export function PlanFlowchart({ efAccountPicker }: { efAccountPicker?: ReactNode }) {
  const { data, isLoading } = useQuery({ queryKey: ["plan"], queryFn: () => api.plan() });
  if (isLoading || !data) return <div className="card"><p className="empty">Loading your plan…</p></div>;

  return (
    <div className="card plan-card">
      <div className="card-head"><h3>Your plan</h3><span className="muted plan-src">UK Personal Finance flowchart</span></div>
      <ol className="plan-steps">
        {data.steps.map((s, i) => (
          <li key={s.key} className={`plan-step is-${s.state}`}>
            <span className="plan-bullet">
              {s.state === "done" ? <Check size={14} strokeWidth={2.6} />
                : s.state === "current" ? <span className="plan-dot" />
                : s.state === "coming" ? <span className="plan-idx">{i + 1}</span>
                : <Lock size={12} strokeWidth={2.2} />}
            </span>
            <div className="plan-body">
              <div className="plan-row">
                <span className="plan-title">{s.title}</span>
                {s.state === "done" && <span className="plan-tag pos">Done</span>}
                {s.toGo != null && s.state === "current" && <span className="num plan-togo">{formatGBP(s.toGo)} to go</span>}
              </div>
              {s.detail && <div className="plan-detail muted">{s.detail}</div>}
              {s.state === "current" && s.progress && (
                <>
                  <div className="progress plan-bar"><i className="ok" style={{ width: `${s.progress.pct}%` }} /></div>
                  <div className="plan-meta">
                    <span className="muted">{formatGBP(s.progress.have)} / {formatGBP(s.progress.target)}</span>
                    {data.surplus > 0 && s.actionHint && <span className="plan-hint pos">{s.actionHint}</span>}
                  </div>
                </>
              )}
              {s.state === "current" && s.key.startsWith("ef_") && !data.efAccount && efAccountPicker && (
                <div className="plan-picker">{efAccountPicker}</div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

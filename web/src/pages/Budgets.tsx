import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { BudgetDTO } from "../../../shared/types.ts";
import { formatMoney } from "../format.ts";

function barState(percent: number): "ok" | "warn" | "over" {
  if (percent > 100) return "over";
  if (percent >= 80) return "warn";
  return "ok";
}

export default function Budgets() {
  const [rows, setRows] = useState<BudgetDTO[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api.budgets().then(setRows).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);

  const edit = async (category: string, current: number) => {
    const v = window.prompt(`Monthly limit for ${category} (£):`, String(current));
    if (v === null) return;
    const n = Number(v);
    if (Number.isNaN(n) || n < 0) { setMsg("Enter a number ≥ 0"); return; }
    try { await api.setBudget(category, n); await load(); } catch (e) { setMsg((e as Error).message); }
  };

  return (
    <div>
      <h1>Budgets <span className="muted" style={{ fontSize: 14, fontFamily: "var(--font-text)" }}>· personal, this month</span></h1>
      {msg && <p className="muted">{msg}</p>}
      {rows.map((r) => (
        <div className="card" key={r.category}>
          <div className="row-between">
            <strong style={{ fontWeight: 600, textTransform: "capitalize" }}>{r.category.replace("-", " ")}</strong>
            <span>
              <span className="num">£{formatMoney(r.spent)}</span> <span className="muted">/ £{formatMoney(r.monthlyLimit)}</span>{" "}
              <button className="btn-sm" onClick={() => edit(r.category, r.monthlyLimit)}>Set</button>
            </span>
          </div>
          <div className="progress">
            <i className={barState(r.percent)} style={{ width: `${Math.min(r.percent, 100)}%` }} />
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {r.monthlyLimit > 0 ? `${r.percent}% used · £${formatMoney(r.remaining)} remaining` : "no limit set"}
          </div>
        </div>
      ))}
    </div>
  );
}

import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { BudgetDTO } from "../../../shared/types.ts";

function barColor(percent: number): string {
  if (percent > 100) return "#dc2626";
  if (percent >= 80) return "#f59e0b";
  return "#16a34a";
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
      <h1>Budgets <span style={{ fontSize: 13, color: "#6b7280" }}>(personal accounts, this month)</span></h1>
      {msg && <p>{msg}</p>}
      {rows.map((r) => (
        <div className="card" key={r.category}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong>{r.category}</strong>
            <span>
              £{r.spent.toFixed(2)} / £{r.monthlyLimit.toFixed(2)}{" "}
              <button onClick={() => edit(r.category, r.monthlyLimit)}>Set</button>
            </span>
          </div>
          <div style={{ background: "#eee", borderRadius: 6, height: 10, marginTop: 8, overflow: "hidden" }}>
            <div style={{ width: `${Math.min(r.percent, 100)}%`, height: "100%", background: barColor(r.percent) }} />
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
            {r.monthlyLimit > 0 ? `${r.percent}% used · £${r.remaining.toFixed(2)} remaining` : "no limit set"}
          </div>
        </div>
      ))}
    </div>
  );
}

import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { BudgetRowDTO } from "../../../shared/types.ts";
import { formatMoney } from "../format.ts";

function nowMonth(): string {
  return new Date().toLocaleDateString("en-CA").slice(0, 7);
}
function barClass(percent: number): string {
  return percent > 100 ? "over" : percent >= 80 ? "warn" : "ok";
}

export default function Budgets() {
  const [month, setMonth] = useState(nowMonth());
  const [people, setPeople] = useState<{ key: string; name: string }[]>([]);
  const [person, setPerson] = useState("");
  const [rows, setRows] = useState<BudgetRowDTO[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { api.people().then(setPeople).catch(() => setPeople([])); }, []);
  const load = () => api.budget(month, person || undefined).then(setRows).catch((e) => setMsg(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [month, person]);

  const totalBudget = rows.reduce((s, r) => s + r.budgeted, 0);
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0);

  return (
    <div>
      <div className="row-between">
        <h1>Budget</h1>
        <div className="toolbar">
          <select value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">Everyone</option>
            <option value="none">Unassigned</option>
            {people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: "auto" }} />
        </div>
      </div>
      {msg && <p className="muted">{msg}</p>}
      <div className="card">
        <div className="row-between"><strong>Total this month</strong><span className="num">£{formatMoney(totalSpent)} <span className="muted">/ £{formatMoney(totalBudget)}</span></span></div>
      </div>
      <div className="card">
        {rows.length === 0 && <p className="muted">No categories — add some on the Categories page.</p>}
        <table>
          <thead><tr><th>Category</th><th>Budget</th><th>Spent</th><th>Left</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ minWidth: 200 }}>
                  {r.name}
                  <div className="progress" style={{ marginTop: 6 }}><i className={barClass(r.percent)} style={{ width: `${Math.min(r.percent, 100)}%` }} /></div>
                </td>
                <td className="num">£{formatMoney(r.budgeted)}</td>
                <td className="num">£{formatMoney(r.spent)}</td>
                <td className={`num ${r.left < 0 ? "neg" : "pos"}`}>£{formatMoney(r.left)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { ReportDTO } from "../../../shared/types.ts";
import { formatMoney } from "../format.ts";

function nowMonth(): string {
  return new Date().toLocaleDateString("en-CA").slice(0, 7);
}
const cell = (v: number | undefined) => (v ? `£${formatMoney(v)}` : "—");

export default function Reports() {
  const [month, setMonth] = useState(nowMonth());
  const [data, setData] = useState<ReportDTO | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { api.report(month).then(setData).catch((e) => setMsg(e.message)); }, [month]);

  if (!data) return <p className="muted">{msg ?? "Loading…"}</p>;
  const people = data.people;

  return (
    <div>
      <div className="row-between">
        <h1>Reports</h1>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: "auto" }} />
      </div>

      <div className="grid">
        <div className="card stat"><span className="label">Income</span><span className="value pos">£{formatMoney(data.summary.income)}</span></div>
        <div className="card stat"><span className="label">Expenses</span><span className="value neg">£{formatMoney(data.summary.expenses)}</span></div>
        <div className="card stat"><span className="label">Net · savings</span><span className="value">£{formatMoney(data.summary.net)} <span className="muted" style={{ fontSize: 15 }}>· {data.summary.savingsRate}%</span></span></div>
      </div>

      <div className="card">
        <h3>Spending by category &amp; person</h3>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              {people.map((p) => <th key={p.key} style={{ textAlign: "right" }}>{p.name}</th>)}
              <th style={{ textAlign: "right" }}>Unassigned</th>
              <th style={{ textAlign: "right" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.categoryKey}>
                <td>{r.name}</td>
                {people.map((p) => <td key={p.key} className="num">{cell(r.byPerson[p.key])}</td>)}
                <td className="num">{cell(r.byPerson.none)}</td>
                <td className="num">£{formatMoney(r.total)}</td>
              </tr>
            ))}
            <tr>
              <td><strong>Total</strong></td>
              {people.map((p) => <td key={p.key} className="num"><strong>{cell(data.personTotals[p.key])}</strong></td>)}
              <td className="num"><strong>{cell(data.personTotals.none)}</strong></td>
              <td className="num"><strong>£{formatMoney(data.grandTotal)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

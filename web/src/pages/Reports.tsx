import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { ReportDTO } from "../../../shared/types.ts";
import { formatGBP, formatMoney } from "../format.ts";
import { BarList } from "../components/BarList.tsx";

function nowMonth(): string {
  return new Date().toLocaleDateString("en-CA").slice(0, 7);
}
const cell = (v: number | undefined) => (v ? `£${formatMoney(v)}` : "—");
const PERSON_COLORS = ["#6FE3B0", "#E2C08D", "#7FB2FF", "#C79BFF", "#F2B14C", "#FF7E6B"];

export default function Reports() {
  const [month, setMonth] = useState(nowMonth());
  const [data, setData] = useState<ReportDTO | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { api.report(month).then(setData).catch((e) => setMsg(e.message)); }, [month]);

  if (!data) return <p className="muted">{msg ?? "Loading…"}</p>;
  const people = data.people;
  const topCats = [...data.rows].sort((a, b) => b.total - a.total).slice(0, 8);
  const byPerson = [
    ...people.map((p, i) => ({ key: p.key, label: p.name, value: data.personTotals[p.key] ?? 0, color: PERSON_COLORS[i % PERSON_COLORS.length] })),
    { key: "none", label: "Unassigned", value: data.personTotals.none ?? 0, color: "#7e7c74" },
  ].filter((p) => p.value > 0).sort((a, b) => b.value - a.value);

  return (
    <div>
      <div className="row-between">
        <h1>Reports</h1>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: "auto" }} />
      </div>

      <div className="grid">
        <div className="card stat"><span className="label">Income</span><span className="value pos">{formatGBP(data.summary.income)}</span></div>
        <div className="card stat"><span className="label">Expenses</span><span className="value neg">{formatGBP(data.summary.expenses)}</span></div>
        <div className="card stat"><span className="label">Net</span><span className="value">{formatGBP(data.summary.net)}</span><span className="delta muted">{data.summary.savingsRate}% saved</span></div>
        <div className="card stat"><span className="label">Categories</span><span className="value">{data.rows.length}</span><span className="delta muted">with spend</span></div>
      </div>

      <div className="grid">
        <div className="card"><h3>Top categories</h3><BarList items={topCats.map((r) => ({ key: r.categoryKey, label: r.name, value: r.total }))} /></div>
        <div className="card"><h3>By person</h3><BarList items={byPerson} /></div>
      </div>

      <div className="card">
        <h3>Spending by category &amp; person</h3>
        <table className="report-table">
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
                <td className="num strong">£{formatMoney(r.total)}</td>
              </tr>
            ))}
            <tr className="report-total">
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

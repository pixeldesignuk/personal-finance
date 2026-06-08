import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { EnvelopeGroupDTO } from "../../../shared/types.ts";
import { formatMoney } from "../format.ts";

function nowMonth(): string {
  return new Date().toLocaleDateString("en-CA").slice(0, 7);
}

export default function Budgets() {
  const [month, setMonth] = useState(nowMonth());
  const [groups, setGroups] = useState<EnvelopeGroupDTO[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api.envelopes(month).then(setGroups).catch((e) => setMsg(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [month]);

  const transfer = async () => {
    const fromName = window.prompt("Move money FROM category:");
    if (!fromName) return;
    const toName = window.prompt("TO category:");
    if (!toName) return;
    const amt = Number(window.prompt("Amount (£):", "0"));
    if (Number.isNaN(amt) || amt <= 0) return;
    try { await api.categoryTransfer({ fromName, toName, month, amount: amt }); await load(); } catch (e) { setMsg((e as Error).message); }
  };

  return (
    <div>
      <div className="row-between">
        <h1>Budget <span className="muted" style={{ fontSize: 14, fontFamily: "var(--font-text)" }}>· envelopes</span></h1>
        <div className="toolbar">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: "auto" }} />
          <button onClick={transfer}>Move money</button>
        </div>
      </div>
      {msg && <p className="muted">{msg}</p>}
      {groups.length === 0 && <p className="muted">No categories yet — add some on the Categories page.</p>}
      {groups.map((g) => (
        <div className="card" key={g.id}>
          <h3 style={{ marginTop: 0 }}>{g.name}</h3>
          <table>
            <thead><tr><th>Category</th><th>Allocated</th><th>Spent</th><th>Available</th></tr></thead>
            <tbody>
              {g.rows.map((r) => {
                const avail = r.available;
                const cls = avail < 0 ? "neg" : "pos";
                return (
                  <tr key={r.name}>
                    <td>{r.name}{r.goal ? <span className="muted"> · goal £{formatMoney(r.goal)}</span> : null}</td>
                    <td className="num">£{formatMoney(r.allocated)}</td>
                    <td className="num">£{formatMoney(r.spent)}</td>
                    <td className={`num ${cls}`}>£{formatMoney(avail)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

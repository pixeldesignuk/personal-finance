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
  const [people, setPeople] = useState<{ key: string; name: string }[]>([]);
  const [person, setPerson] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { api.people().then(setPeople).catch(() => setPeople([])); }, []);
  const load = () => api.envelopes(month, person || undefined).then(setGroups).catch((e) => setMsg(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [month, person]);

  const transfer = async () => {
    const fromKey = window.prompt("Move money FROM category (key):");
    if (!fromKey) return;
    const toKey = window.prompt("TO category (key):");
    if (!toKey) return;
    const amt = Number(window.prompt("Amount (£):", "0"));
    if (Number.isNaN(amt) || amt <= 0) return;
    try { await api.categoryTransfer({ fromKey, toKey, month, amount: amt }); await load(); } catch (e) { setMsg((e as Error).message); }
  };

  return (
    <div>
      <div className="row-between">
        <h1>Budget <span className="muted" style={{ fontSize: 14, fontFamily: "var(--font-text)" }}>· envelopes</span></h1>
        <div className="toolbar">
          <select value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">Everyone</option>
            <option value="none">Unassigned</option>
            {people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
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
                  <tr key={r.key}>
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

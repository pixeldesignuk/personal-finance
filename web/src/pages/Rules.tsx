import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { RuleDTO, CategoryNameDTO, PersonDTO } from "../../../shared/types.ts";

export default function Rules() {
  const [rules, setRules] = useState<RuleDTO[]>([]);
  const [cats, setCats] = useState<CategoryNameDTO[]>([]);
  const [people, setPeople] = useState<PersonDTO[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState({ matchText: "", categoryKey: "", personKey: "", priority: "0" });

  const load = () => { api.rules().then(setRules).catch(() => {}); api.categoryNames().then(setCats).catch(() => {}); api.people().then(setPeople).catch(() => {}); };
  useEffect(() => { load(); }, []);
  const wrap = async (fn: () => Promise<unknown>) => { try { await fn(); load(); } catch (e) { setMsg((e as Error).message); } };

  const add = () => {
    if (!draft.matchText.trim()) { setMsg("Enter a match phrase"); return; }
    if (!draft.categoryKey && !draft.personKey) { setMsg("Pick a category or a person"); return; }
    wrap(() => api.createRule({ matchText: draft.matchText.trim(), categoryKey: draft.categoryKey || null, personKey: draft.personKey || null, priority: Number(draft.priority) || 0 }));
    setDraft({ matchText: "", categoryKey: "", personKey: "", priority: "0" });
  };
  const reapply = () => wrap(async () => { const r = await api.applyRules(); setMsg(`Applied: ${r.categorised} categorised, ${r.personed} tagged`); });

  return (
    <div>
      <div className="row-between"><h1>Rules</h1><button onClick={reapply}>Re-apply rules now</button></div>
      {msg && <p className="muted">{msg}</p>}
      <div className="card">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input placeholder="match text (e.g. tesco)" value={draft.matchText} onChange={(e) => setDraft({ ...draft, matchText: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
          <select value={draft.categoryKey} onChange={(e) => setDraft({ ...draft, categoryKey: e.target.value })}>
            <option value="">— category —</option>{cats.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
          <select value={draft.personKey} onChange={(e) => setDraft({ ...draft, personKey: e.target.value })}>
            <option value="">— person —</option>{people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
          <input style={{ width: 70 }} value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} title="priority" />
          <button className="btn-primary" onClick={add}>Add</button>
        </div>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Match</th><th>Category</th><th>Person</th><th>Priority</th><th></th></tr></thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{r.matchText} {r.auto && <span className="badge" style={{ marginLeft: 6, fontSize: 11 }} title="Learned automatically from an AI categorisation">auto</span>}</td>
                <td>{cats.find((c) => c.key === r.categoryKey)?.name ?? "—"}</td>
                <td>{people.find((p) => p.key === r.personKey)?.name ?? "—"}</td>
                <td className="num">{r.priority}</td>
                <td style={{ textAlign: "right" }}><button className="btn-danger btn-sm" onClick={() => wrap(() => api.deleteRule(r.id))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

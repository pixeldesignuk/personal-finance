import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { CategoryGroupDTO } from "../../../shared/types.ts";
import { formatMoney } from "../format.ts";

export default function Categories() {
  const [groups, setGroups] = useState<CategoryGroupDTO[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api.categories().then(setGroups).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  const wrap = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); } catch (e) { setMsg((e as Error).message); } };

  const addGroup = () => { const n = window.prompt("New group name:"); if (n) wrap(() => api.createGroup(n)); };
  const addCat = (groupId: number) => {
    const name = window.prompt("Category name:"); if (!name) return;
    const amt = Number(window.prompt("Monthly amount (£):", "0")) || 0;
    const goalRaw = window.prompt("Goal (£, blank for none):", "");
    const goal = goalRaw && !Number.isNaN(Number(goalRaw)) ? Number(goalRaw) : null;
    wrap(() => api.createCategory({ name, groupId, monthlyAmount: amt, goal }));
  };
  const editAmount = (id: number, current: number) => {
    const v = window.prompt("Monthly amount (£):", String(current)); if (v === null) return;
    const n = Number(v); if (Number.isNaN(n) || n < 0) return;
    wrap(() => api.patchCategory(id, { monthlyAmount: n }));
  };
  const editGoal = (id: number, current: number | null) => {
    const v = window.prompt("Goal (£, blank for none):", current != null ? String(current) : ""); if (v === null) return;
    const goal = v.trim() === "" ? null : Number(v);
    if (goal != null && Number.isNaN(goal)) return;
    wrap(() => api.patchCategory(id, { goal }));
  };
  const rename = (id: number, current: string) => { const n = window.prompt("Rename category:", current); if (n && n !== current) wrap(() => api.patchCategory(id, { name: n })); };
  const archive = (id: number) => { if (window.confirm("Archive this category?")) wrap(() => api.patchCategory(id, { archived: true })); };

  return (
    <div>
      <div className="row-between">
        <h1>Categories</h1>
        <button className="btn-primary" onClick={addGroup}>Add group</button>
      </div>
      {msg && <p className="muted">{msg}</p>}
      {groups.map((g) => (
        <div className="card" key={g.id}>
          <div className="row-between">
            <h3 style={{ margin: 0 }}>{g.name}</h3>
            <button className="btn-sm" onClick={() => addCat(g.id)}>Add category</button>
          </div>
          <table style={{ marginTop: 10 }}>
            <thead><tr><th>Name</th><th>Monthly</th><th>Goal</th><th></th></tr></thead>
            <tbody>
              {g.categories.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="num">£{formatMoney(c.monthlyAmount)}</td>
                  <td className="num">{c.goal != null ? `£${formatMoney(c.goal)}` : "—"}</td>
                  <td style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                    <button className="btn-sm" onClick={() => editAmount(c.id, c.monthlyAmount)}>Amount</button>
                    <button className="btn-sm" onClick={() => editGoal(c.id, c.goal)}>Goal</button>
                    <button className="btn-sm" onClick={() => rename(c.id, c.name)}>Rename</button>
                    <button className="btn-danger btn-sm" onClick={() => archive(c.id)}>Archive</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

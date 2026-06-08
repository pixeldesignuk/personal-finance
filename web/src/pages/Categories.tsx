import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import type { CategoryGroupDTO } from "../../../shared/types.ts";
import { formatMoney } from "../format.ts";

export default function Categories() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [groups, setGroups] = useState<CategoryGroupDTO[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", groupId: 0, monthlyAmount: "0", goal: "" });

  const load = () => api.categories().then(setGroups).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  const wrap = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); dialog.current?.close(); } catch (e) { setMsg((e as Error).message); } };

  const openNew = (groupId: number) => { setEditId(null); setForm({ name: "", groupId, monthlyAmount: "0", goal: "" }); dialog.current?.showModal(); };
  const openEdit = (c: { id: number; name: string; groupId: number; monthlyAmount: number; goal: number | null }) => {
    setEditId(c.id); setForm({ name: c.name, groupId: c.groupId, monthlyAmount: String(c.monthlyAmount), goal: c.goal != null ? String(c.goal) : "" }); dialog.current?.showModal();
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const monthlyAmount = Number(form.monthlyAmount) || 0;
    const goal = form.goal.trim() === "" ? null : Number(form.goal);
    if (goal != null && Number.isNaN(goal)) { setMsg("Goal must be a number"); return; }
    if (editId == null) wrap(() => api.createCategory({ name: form.name, groupId: form.groupId, monthlyAmount, goal }));
    else wrap(() => api.patchCategory(editId, { name: form.name, groupId: form.groupId, monthlyAmount, goal }));
  };
  const addGroup = () => { const n = window.prompt("New group name:"); if (n) wrap(() => api.createGroup(n)); };
  const archive = (id: number) => { if (window.confirm("Archive this category?")) wrap(() => api.patchCategory(id, { archived: true })); };

  return (
    <div>
      <div className="row-between"><h1>Categories</h1><button className="btn-primary" onClick={addGroup}>Add group</button></div>
      {msg && <p className="muted">{msg}</p>}
      {groups.map((g) => (
        <div className="card" key={g.id}>
          <div className="row-between"><h3 style={{ margin: 0 }}>{g.name}</h3><button className="btn-sm" onClick={() => openNew(g.id)}>Add category</button></div>
          <table style={{ marginTop: 10 }}>
            <thead><tr><th>Name</th><th>Monthly</th><th>Goal</th><th></th></tr></thead>
            <tbody>
              {g.categories.map((c) => (
                <tr key={c.id}>
                  <td>{c.name} <span className="muted" style={{ fontSize: 12 }}>{c.key}</span></td>
                  <td className="num">£{formatMoney(c.monthlyAmount)}</td>
                  <td className="num">{c.goal != null ? `£${formatMoney(c.goal)}` : "—"}</td>
                  <td style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <button className="btn-sm" onClick={() => openEdit(c)}>Edit</button>
                    <button className="btn-danger btn-sm" onClick={() => archive(c.id)}>Archive</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <dialog ref={dialog} className="modal" onClick={(e) => { if (e.target === dialog.current) dialog.current?.close(); }}>
        <form className="modal-body" onSubmit={submit}>
          <h3 style={{ marginTop: 0 }}>{editId == null ? "New category" : "Edit category"}</h3>
          <label className="field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></label>
          <label className="field"><span>Group</span>
            <select value={form.groupId} onChange={(e) => setForm({ ...form, groupId: Number(e.target.value) })}>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          <div style={{ display: "flex", gap: 12 }}>
            <label className="field" style={{ flex: 1 }}><span>Monthly (£)</span><input inputMode="decimal" value={form.monthlyAmount} onChange={(e) => setForm({ ...form, monthlyAmount: e.target.value })} /></label>
            <label className="field" style={{ flex: 1 }}><span>Goal (£)</span><input inputMode="decimal" value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} placeholder="none" /></label>
          </div>
          <div className="modal-actions"><button type="button" onClick={() => dialog.current?.close()}>Cancel</button><button className="btn-primary" type="submit">Save</button></div>
        </form>
      </dialog>
    </div>
  );
}

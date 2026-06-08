import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import type { CategoryDTO } from "../../../shared/types.ts";
import { formatMoney } from "../format.ts";

export default function Categories() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [cats, setCats] = useState<CategoryDTO[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", monthlyAmount: "0" });

  const load = () => api.categories().then(setCats).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  const wrap = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); dialog.current?.close(); } catch (e) { setMsg((e as Error).message); } };

  const openNew = () => { setEditId(null); setForm({ name: "", monthlyAmount: "0" }); dialog.current?.showModal(); };
  const openEdit = (c: CategoryDTO) => { setEditId(c.id); setForm({ name: c.name, monthlyAmount: String(c.monthlyAmount) }); dialog.current?.showModal(); };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const monthlyAmount = Number(form.monthlyAmount) || 0;
    if (!form.name.trim()) { setMsg("Enter a name"); return; }
    if (editId == null) wrap(() => api.createCategory({ name: form.name.trim(), monthlyAmount }));
    else wrap(() => api.patchCategory(editId, { name: form.name.trim(), monthlyAmount }));
  };
  const archive = (id: number) => { if (window.confirm("Archive this category?")) wrap(() => api.patchCategory(id, { archived: true })); };

  return (
    <div>
      <div className="row-between"><h1>Categories</h1><button className="btn-primary" onClick={openNew}>Add category</button></div>
      {msg && <p className="muted">{msg}</p>}
      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>Monthly budget</th><th></th></tr></thead>
          <tbody>
            {cats.map((c) => (
              <tr key={c.id}>
                <td>{c.name} <span className="muted" style={{ fontSize: 12 }}>{c.key}</span></td>
                <td className="num">£{formatMoney(c.monthlyAmount)}</td>
                <td style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button className="btn-sm" onClick={() => openEdit(c)}>Edit</button>
                  <button className="btn-danger btn-sm" onClick={() => archive(c.id)}>Archive</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dialog ref={dialog} className="modal" onClick={(e) => { if (e.target === dialog.current) dialog.current?.close(); }}>
        <form className="modal-body" onSubmit={submit}>
          <h3 style={{ marginTop: 0 }}>{editId == null ? "New category" : "Edit category"}</h3>
          <label className="field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></label>
          <label className="field"><span>Monthly budget (£)</span><input inputMode="decimal" value={form.monthlyAmount} onChange={(e) => setForm({ ...form, monthlyAmount: e.target.value })} /></label>
          <div className="modal-actions"><button type="button" onClick={() => dialog.current?.close()}>Cancel</button><button className="btn-primary" type="submit">Save</button></div>
        </form>
      </dialog>
    </div>
  );
}

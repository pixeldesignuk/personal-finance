import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.ts";
import type { PotDTO } from "../../../shared/types.ts";
import { formatGBP } from "../format.ts";

const num = (s: string) => { const n = Number(s.replace(/[, £]/g, "")); return Number.isFinite(n) ? n : NaN; };

export default function Savings() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["pots"], queryFn: () => api.pots() });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["pots"] });

  const create = useMutation({ mutationFn: (i: Parameters<typeof api.createPot>[0]) => api.createPot(i), onSuccess: invalidate });
  const patch = useMutation({ mutationFn: ({ id, p }: { id: number; p: Parameters<typeof api.patchPot>[1] }) => api.patchPot(id, p), onSuccess: invalidate });
  const move = useMutation({ mutationFn: ({ id, amount }: { id: number; amount: number }) => api.movePot(id, amount), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: number) => api.deletePot(id), onSuccess: invalidate });

  // create / edit dialog
  const dialog = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState<PotDTO | null>(null);
  const [form, setForm] = useState({ emoji: "", name: "", target: "", balance: "" });
  const openNew = () => { setEditing(null); setForm({ emoji: "", name: "", target: "", balance: "" }); dialog.current?.showModal(); };
  const openEdit = (p: PotDTO) => { setEditing(p); setForm({ emoji: p.emoji ?? "", name: p.name, target: p.target != null ? String(p.target) : "", balance: "" }); dialog.current?.showModal(); };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const target = form.target.trim() ? Math.max(0, num(form.target)) : null;
    const emoji = form.emoji.trim() || null;
    if (editing) {
      patch.mutate({ id: editing.id, p: { name: form.name.trim(), target: Number.isNaN(target as number) ? null : target, emoji } });
    } else {
      const balance = form.balance.trim() ? Math.max(0, num(form.balance)) : 0;
      create.mutate({ name: form.name.trim(), target: Number.isNaN(target as number) ? null : target, emoji, balance: Number.isNaN(balance) ? 0 : balance });
    }
    dialog.current?.close();
  };

  const deposit = (p: PotDTO, sign: 1 | -1) => {
    const raw = window.prompt(`${sign > 0 ? "Add to" : "Take from"} ${p.name} (£):`, "");
    if (raw == null) return;
    const amt = num(raw);
    if (!Number.isFinite(amt) || amt <= 0) return;
    move.mutate({ id: p.id, amount: sign * amt });
  };
  const del = (p: PotDTO) => { if (window.confirm(`Delete pot "${p.name}"? The earmarked £${p.balance} returns to unallocated.`)) remove.mutate(p.id); };

  if (!data) return <p>Loading…</p>;
  const over = data.unallocated < 0;

  return (
    <div>
      <div className="row-between">
        <h1>Savings</h1>
        <button className="btn-primary" onClick={openNew}>New pot</button>
      </div>
      <p className="muted" style={{ marginTop: -6 }}>Pots earmark cash you already hold — they don't change your net worth.</p>

      <div className="grid">
        <div className="card stat"><span className="label">Liquid cash</span><span className="value">{formatGBP(data.liquid)}</span><span className="delta muted">across current + cash accounts</span></div>
        <div className="card stat"><span className="label">Allocated</span><span className="value">{formatGBP(data.allocated)}</span><span className="delta muted">{data.pots.length} pot{data.pots.length === 1 ? "" : "s"}</span></div>
        <div className="card stat"><span className="label">Unallocated</span><span className={`value ${over ? "neg" : "pos"}`}>{formatGBP(data.unallocated)}</span><span className="delta muted">{over ? "over-allocated" : "free to assign"}</span></div>
      </div>

      {data.pots.length === 0 && <div className="card"><p className="muted">No pots yet. Create one to set money aside toward a goal.</p></div>}

      <div className="grid pot-cards">
        {data.pots.map((p) => {
          const pct = p.target && p.target > 0 ? Math.min(100, Math.round((p.balance / p.target) * 100)) : null;
          const toGo = p.target != null ? Math.max(0, p.target - p.balance) : null;
          const done = pct === 100;
          return (
            <div className="card pot-card" key={p.id}>
              <div className="pot-head">
                <span className="pot-emoji" aria-hidden>{p.emoji || "🫙"}</span>
                <span className="pot-name">{p.name}</span>
                <button className="btn-sm pot-edit" title="Edit pot" onClick={() => openEdit(p)}>✎</button>
              </div>
              <div className="pot-figure">
                <span className="pot-bal">{formatGBP(p.balance)}</span>
                {p.target != null && <span className="pot-target muted">of {formatGBP(p.target)}</span>}
              </div>
              {pct != null && (
                <>
                  <div className="progress"><i className="ok" style={{ width: `${pct}%` }} /></div>
                  <div className="pot-meta">
                    <span className={done ? "pos" : "muted"}>{done ? "Goal reached 🎉" : `${pct}%`}</span>
                    {!done && <span className="muted">{formatGBP(toGo as number)} to go</span>}
                  </div>
                </>
              )}
              <div className="pot-actions">
                <button className="btn-sm" onClick={() => deposit(p, 1)}>＋ Add</button>
                <button className="btn-sm" onClick={() => deposit(p, -1)}>－ Take</button>
                <button className="btn-danger btn-sm" onClick={() => del(p)}>Delete</button>
              </div>
            </div>
          );
        })}
      </div>

      <dialog ref={dialog} className="modal" onClick={(e) => { if (e.target === dialog.current) dialog.current?.close(); }}>
        <form className="modal-body" onSubmit={submit}>
          <h3 style={{ marginTop: 0 }}>{editing ? "Edit pot" : "New pot"}</h3>
          <div style={{ display: "flex", gap: 10 }}>
            <label className="field" style={{ width: 76 }}><span>Icon</span><input value={form.emoji} maxLength={4} placeholder="🫙" style={{ textAlign: "center", fontSize: 18 }} onChange={(e) => setForm({ ...form, emoji: e.target.value })} /></label>
            <label className="field" style={{ flex: 1 }}><span>Name</span><input value={form.name} autoFocus placeholder="e.g. Emergency fund" onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          </div>
          <label className="field"><span>Target (£, optional)</span><input inputMode="decimal" value={form.target} placeholder="10000" onChange={(e) => setForm({ ...form, target: e.target.value })} /></label>
          {!editing && <label className="field"><span>Starting amount (£, optional)</span><input inputMode="decimal" value={form.balance} placeholder="0" onChange={(e) => setForm({ ...form, balance: e.target.value })} /></label>}
          <div className="modal-actions"><button type="button" onClick={() => dialog.current?.close()}>Cancel</button><button className="btn-primary" type="submit">{editing ? "Save" : "Create"}</button></div>
        </form>
      </dialog>
    </div>
  );
}

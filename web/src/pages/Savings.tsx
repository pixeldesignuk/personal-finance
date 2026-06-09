import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.ts";
import type { PotDTO } from "../../../shared/types.ts";
import { formatGBP } from "../format.ts";
import { IconPicker, PotIcon } from "../components/IconPicker.tsx";

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

  // Move (add / take) dialog.
  const moveDialog = useRef<HTMLDialogElement>(null);
  const [moveState, setMoveState] = useState<{ pot: PotDTO; sign: 1 | -1 } | null>(null);
  const [moveAmt, setMoveAmt] = useState("");
  const openMove = (pot: PotDTO, sign: 1 | -1) => { setMoveState({ pot, sign }); setMoveAmt(""); moveDialog.current?.showModal(); };
  const submitMove = (e: React.FormEvent) => {
    e.preventDefault();
    if (!moveState) return;
    const amt = num(moveAmt);
    if (!Number.isFinite(amt) || amt <= 0) return;
    move.mutate({ id: moveState.pot.id, amount: moveState.sign * amt });
    moveDialog.current?.close();
  };

  // Delete confirmation dialog.
  const delDialog = useRef<HTMLDialogElement>(null);
  const [delTarget, setDelTarget] = useState<PotDTO | null>(null);
  const openDel = (pot: PotDTO) => { setDelTarget(pot); delDialog.current?.showModal(); };
  const confirmDel = () => { if (delTarget) remove.mutate(delTarget.id); delDialog.current?.close(); };

  if (!data) return <p>Loading…</p>;
  const over = data.available < 0;

  return (
    <div>
      <div className="row-between">
        <h1>Savings</h1>
        <button className="btn-primary" onClick={openNew}>New pot</button>
      </div>
      <p className="muted" style={{ marginTop: -6 }}>Pots earmark cash you already hold — they don't change your net worth.</p>

      <div className="grid">
        <div className="card stat"><span className="label">Liquid cash</span><span className="value">{formatGBP(data.liquid)}</span><span className="delta muted">{formatGBP(data.budgeted)} budgeted · {formatGBP(data.allocated)} in pots</span></div>
        <div className="card stat"><span className="label">In pots</span><span className="value">{formatGBP(data.allocated)}</span><span className="delta muted">{data.pots.length} pot{data.pots.length === 1 ? "" : "s"}</span></div>
        <div className="card stat"><span className="label">Available to assign</span><span className={`value ${over ? "neg" : "pos"}`}>{formatGBP(data.available)}</span><span className="delta muted">{over ? "over-allocated" : "after budgets & pots"}</span></div>
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
                <span className="pot-emoji" aria-hidden><PotIcon icon={p.emoji} size={18} /></span>
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
                <button className="btn-sm" onClick={() => openMove(p, 1)}>＋ Add</button>
                <button className="btn-sm" disabled={p.balance <= 0} onClick={() => openMove(p, -1)}>－ Take</button>
                <button className="btn-danger btn-sm" onClick={() => openDel(p)}>Delete</button>
              </div>
            </div>
          );
        })}
      </div>

      <dialog ref={dialog} className="modal" onClick={(e) => { if (e.target === dialog.current) dialog.current?.close(); }}>
        <form className="modal-body" onSubmit={submit}>
          <h3 style={{ marginTop: 0 }}>{editing ? "Edit pot" : "New pot"}</h3>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <label className="field" style={{ width: "auto" }}><span>Icon</span><IconPicker value={form.emoji || null} onChange={(k) => setForm({ ...form, emoji: k })} /></label>
            <label className="field" style={{ flex: 1 }}><span>Name</span><input value={form.name} autoFocus placeholder="e.g. Emergency fund" onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          </div>
          <label className="field"><span>Target (£, optional)</span><input inputMode="decimal" value={form.target} placeholder="10000" onChange={(e) => setForm({ ...form, target: e.target.value })} /></label>
          {!editing && <label className="field"><span>Starting amount (£, optional)</span><input inputMode="decimal" value={form.balance} placeholder="0" onChange={(e) => setForm({ ...form, balance: e.target.value })} /></label>}
          <div className="modal-actions"><button type="button" onClick={() => dialog.current?.close()}>Cancel</button><button className="btn-primary" type="submit">{editing ? "Save" : "Create"}</button></div>
        </form>
      </dialog>

      <dialog ref={moveDialog} className="modal" onClick={(e) => { if (e.target === moveDialog.current) moveDialog.current?.close(); }}>
        {moveState && (
          <form className="modal-body" onSubmit={submitMove}>
            <h3 style={{ marginTop: 0 }}>{moveState.sign > 0 ? "Add to" : "Take from"} {moveState.pot.name}</h3>
            <p className="muted" style={{ marginTop: -4 }}>Currently {formatGBP(moveState.pot.balance)} set aside.</p>
            {moveState.sign > 0 && (
              <p className="muted" style={{ marginTop: -4 }}>
                {formatGBP(Math.max(0, data.available))} available to assign — after budgets &amp; other pots.
                {data.available > 0 && <button type="button" className="btn-sm" style={{ marginLeft: 8 }} onClick={() => setMoveAmt(String(data.available))}>Max</button>}
              </p>
            )}
            <label className="field"><span>Amount (£)</span><input inputMode="decimal" autoFocus value={moveAmt} placeholder="0" onChange={(e) => setMoveAmt(e.target.value)} /></label>
            {moveState.sign > 0 && num(moveAmt) > data.available && <p className="neg" style={{ marginTop: -4 }}>That's more than you have available — you'd be over-allocating cash.</p>}
            {moveState.sign < 0 && num(moveAmt) > moveState.pot.balance && <p className="neg" style={{ marginTop: -4 }}>More than the pot holds — it'll be emptied to £0.</p>}
            <div className="modal-actions"><button type="button" onClick={() => moveDialog.current?.close()}>Cancel</button><button className="btn-primary" type="submit">{moveState.sign > 0 ? "Add" : "Take"}</button></div>
          </form>
        )}
      </dialog>

      <dialog ref={delDialog} className="modal" onClick={(e) => { if (e.target === delDialog.current) delDialog.current?.close(); }}>
        {delTarget && (
          <div className="modal-body">
            <h3 style={{ marginTop: 0 }}>Delete “{delTarget.name}”?</h3>
            <p className="muted">The {formatGBP(delTarget.balance)} earmarked here returns to unallocated. This can't be undone.</p>
            <div className="modal-actions"><button type="button" onClick={() => delDialog.current?.close()}>Cancel</button><button className="btn-danger" onClick={confirmDel}>Delete pot</button></div>
          </div>
        )}
      </dialog>
    </div>
  );
}

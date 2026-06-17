import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.ts";
import type { PotDTO } from "../../../shared/types.ts";
import { formatGBP } from "../format.ts";
import { IconPicker, PotIcon } from "../components/IconPicker.tsx";
import { PageHeader, Stat, EmptyState, Modal, Field, FieldRow, useConfirm } from "../components/ui";
import { PlanFlowchart } from "../components/PlanFlowchart.tsx";

const num = (s: string) => { const n = Number(s.replace(/[, £]/g, "")); return Number.isFinite(n) ? n : NaN; };

export default function Savings() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data } = useQuery({ queryKey: ["pots"], queryFn: () => api.pots() });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["pots"] });

  const create = useMutation({ mutationFn: (i: Parameters<typeof api.createPot>[0]) => api.createPot(i), onSuccess: invalidate });
  const patch = useMutation({ mutationFn: ({ id, p }: { id: number; p: Parameters<typeof api.patchPot>[1] }) => api.patchPot(id, p), onSuccess: invalidate });
  const move = useMutation({ mutationFn: ({ id, amount }: { id: number; amount: number }) => api.movePot(id, amount), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: number) => api.deletePot(id), onSuccess: invalidate });

  // create / edit dialog
  const [potOpen, setPotOpen] = useState(false);
  const [editing, setEditing] = useState<PotDTO | null>(null);
  const [form, setForm] = useState({ emoji: "", name: "", target: "", balance: "" });
  const openNew = () => { setEditing(null); setForm({ emoji: "", name: "", target: "", balance: "" }); setPotOpen(true); };
  const openEdit = (p: PotDTO) => { setEditing(p); setForm({ emoji: p.emoji ?? "", name: p.name, target: p.target != null ? String(p.target) : "", balance: "" }); setPotOpen(true); };
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
    setPotOpen(false);
  };

  // Move (add / take) dialog.
  const [moveState, setMoveState] = useState<{ pot: PotDTO; sign: 1 | -1 } | null>(null);
  const [moveAmt, setMoveAmt] = useState("");
  const openMove = (pot: PotDTO, sign: 1 | -1) => { setMoveState({ pot, sign }); setMoveAmt(""); };
  const submitMove = (e: React.FormEvent) => {
    e.preventDefault();
    if (!moveState) return;
    const amt = num(moveAmt);
    if (!Number.isFinite(amt) || amt <= 0) return;
    move.mutate({ id: moveState.pot.id, amount: moveState.sign * amt });
    setMoveState(null);
  };

  const askDel = async (pot: PotDTO) => {
    if (await confirm({ title: `Delete “${pot.name}”?`, body: `The ${formatGBP(pot.balance)} earmarked here returns to unallocated. This can't be undone.`, confirmLabel: "Delete pot", danger: true })) {
      remove.mutate(pot.id);
    }
  };

  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: () => api.accounts(), staleTime: 5 * 60_000 });
  const savingsAccounts = (accountsQ.data ?? []).flatMap((b) => b.accounts).filter((a) => a.source === "BANK" || a.source === "MANUAL");
  const tagEf = useMutation({
    mutationFn: (id: string) => api.patchSettings({ "savings.emergencyAccountId": id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plan"] }),
  });
  const efPicker = (
    <label className="plan-ef-picker">
      <span className="eyebrow">Which account is your emergency fund?</span>
      <select defaultValue="" onChange={(e) => e.target.value && tagEf.mutate(e.target.value)}>
        <option value="" disabled>Choose an account…</option>
        {savingsAccounts.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
      </select>
    </label>
  );

  if (!data) return <p className="muted">Loading…</p>;
  const over = data.available < 0;

  return (
    <div>
      <PageHeader
        title="Savings"
        subtitle="Your saving plan, then the pots you're filling toward it."
        actions={<button className="btn-primary" onClick={openNew}>New pot</button>}
      />

      <div className="grid">
        <Stat label="Liquid cash" value={formatGBP(data.liquid)} delta={`${formatGBP(data.budgeted)} budgeted · ${formatGBP(data.allocated)} in pots`} />
        <Stat label="In pots" value={formatGBP(data.allocated)} delta={`${data.pots.length} pot${data.pots.length === 1 ? "" : "s"}`} />
        <Stat label="Available to assign" value={formatGBP(data.available)} valueTone={over ? "neg" : "pos"} delta={over ? "over-allocated" : "after budgets & pots"} />
      </div>

      <PlanFlowchart efAccountPicker={efPicker} />

      {data.pots.length === 0 && <EmptyState>No pots yet. Create one to set money aside toward a goal.</EmptyState>}

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
                <button className="btn-danger btn-sm" onClick={() => askDel(p)}>Delete</button>
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={potOpen} onClose={() => setPotOpen(false)}>
        <form className="modal-body" onSubmit={submit}>
          <h3>{editing ? "Edit pot" : "New pot"}</h3>
          <FieldRow>
            <Field label="Icon" inline><IconPicker value={form.emoji || null} onChange={(k) => setForm({ ...form, emoji: k })} /></Field>
            <Field label="Name"><input value={form.name} autoFocus placeholder="e.g. Emergency fund" onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          </FieldRow>
          <Field label="Target (£, optional)"><input inputMode="decimal" value={form.target} placeholder="10000" onChange={(e) => setForm({ ...form, target: e.target.value })} /></Field>
          {!editing && <Field label="Starting amount (£, optional)"><input inputMode="decimal" value={form.balance} placeholder="0" onChange={(e) => setForm({ ...form, balance: e.target.value })} /></Field>}
          <div className="modal-actions"><button type="button" onClick={() => setPotOpen(false)}>Cancel</button><button className="btn-primary" type="submit">{editing ? "Save" : "Create"}</button></div>
        </form>
      </Modal>

      <Modal open={moveState != null} onClose={() => setMoveState(null)} size="sm">
        {moveState && (() => {
          const isAdd = moveState.sign > 0;
          const max = isAdd ? Math.max(0, data.available) : moveState.pot.balance;
          const isOver = isAdd ? num(moveAmt) > data.available : num(moveAmt) > moveState.pot.balance;
          return (
            <form className="modal-body" onSubmit={submitMove}>
              <h3>{isAdd ? "Add to" : "Take from"} {moveState.pot.name}</h3>
              <div className="pot-move-info">
                <div><span className="eyebrow">In this pot</span><span className="pot-move-val">{formatGBP(moveState.pot.balance)}</span></div>
                {isAdd && <div><span className="eyebrow">Available</span><span className={`pot-move-val ${data.available < 0 ? "neg" : ""}`}>{formatGBP(Math.max(0, data.available))}</span></div>}
              </div>
              <Field label="Amount" hint={isOver
                ? <span className="neg">{isAdd ? "More than your available cash — you'd be over-allocating." : "More than the pot holds — it'll be emptied to £0."}</span>
                : isAdd ? "Available is what's left after budgets & other pots." : undefined}>
                <div className="amount-input">
                  <span className="amount-prefix" aria-hidden>£</span>
                  <input inputMode="decimal" autoFocus value={moveAmt} placeholder="0.00" onChange={(e) => setMoveAmt(e.target.value)} />
                  {max > 0 && <button type="button" className="amount-max" onClick={() => setMoveAmt(String(max))}>Max</button>}
                </div>
              </Field>
              <div className="modal-actions"><button type="button" onClick={() => setMoveState(null)}>Cancel</button><button className="btn-primary" type="submit" disabled={!(num(moveAmt) > 0)}>{isAdd ? "Add" : "Take"}</button></div>
            </form>
          );
        })()}
      </Modal>
    </div>
  );
}

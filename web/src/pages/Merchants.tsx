import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.ts";
import type { MerchantDTO } from "../../../shared/types.ts";
import { formatGBP, relativeDate } from "../format.ts";
import { Combobox } from "../components/Combobox.tsx";

const TABS: [string, string][] = [["all", "All"], ["fixed", "Recurring"], ["variable", "Variable"]];
const TYPE_LABEL: Record<string, string> = { fixed: "Recurring", variable: "Variable", oneoff: "One-off", ignore: "Ignored", auto: "Auto" };

export default function Merchants() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["merchants"], queryFn: () => api.merchants() });
  const catNames = (useQuery({ queryKey: ["categoryNames"], queryFn: () => api.categoryNames(), staleTime: 5 * 60_000 }).data ?? []);
  const people = (useQuery({ queryKey: ["people"], queryFn: () => api.people(), staleTime: 5 * 60_000 }).data ?? []);
  const [tab, setTab] = useState("all");

  const catOpts = useMemo(() => catNames.map((c) => ({ value: c.key, label: c.name })), [catNames]);
  const personOpts = useMemo(() => people.map((p) => ({ value: p.key, label: p.name })), [people]);

  const patchM = useMutation({
    mutationFn: ({ token, patch }: { token: string; patch: Parameters<typeof api.patchMerchant>[1] }) => api.patchMerchant(token, patch),
    onMutate: async ({ token, patch }) => {
      await qc.cancelQueries({ queryKey: ["merchants"] });
      const prev = qc.getQueryData(["merchants"]);
      qc.setQueryData(["merchants"], (old: typeof data) => old ? { ...old, merchants: old.merchants.map((m) => m.token === token ? { ...m, ...patch, override: patch.recurring ?? m.override, effective: patch.recurring ? (patch.recurring === "auto" ? m.detected : patch.recurring) : m.effective } : m) } : old);
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["merchants"], ctx.prev); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ["merchants"] }); qc.invalidateQueries({ queryKey: ["transactions"] }); },
  });
  const set = (token: string, patch: Parameters<typeof api.patchMerchant>[1]) => patchM.mutate({ token, patch });

  // Full-edit dialog (name + priority + everything).
  const dialog = useRef<HTMLDialogElement>(null);
  const [edit, setEdit] = useState<MerchantDTO | null>(null);
  const [form, setForm] = useState({ name: "", priority: "0" });
  const openEdit = (m: MerchantDTO) => { setEdit(m); setForm({ name: m.name ?? "", priority: String(m.priority) }); dialog.current?.showModal(); };
  const saveEdit = () => {
    if (!edit) return;
    set(edit.token, { name: form.name.trim() || null, priority: Number(form.priority) || 0 });
    dialog.current?.close();
  };

  const shown = useMemo(() => (data?.merchants ?? []).filter((m) => tab === "all" || m.effective === tab), [data, tab]);

  return (
    <div>
      <h1>Merchants</h1>
      {data && (
        <div className="grid">
          <div className="card stat"><span className="label">Monthly outgoings</span><span className="value">{formatGBP(data.monthlyOutgoings)}</span><span className="delta muted">committed / recurring</span></div>
          <div className="card stat"><span className="label">Variable / month</span><span className="value">{formatGBP(data.variableMonthly)}</span><span className="delta muted">avg flexible spend</span></div>
          <div className="card stat"><span className="label">Merchants</span><span className="value">{data.merchants.length}</span></div>
        </div>
      )}

      <div className="tabs">{TABS.map(([k, l]) => <button key={k} className={`tab${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>{l}</button>)}</div>

      <div className="card">
        <table className="txn-table">
          <colgroup><col /><col style={{ width: 170 }} /><col style={{ width: 130 }} /><col style={{ width: 150 }} /><col style={{ width: 104 }} /><col style={{ width: 100 }} /><col style={{ width: 60 }} /><col style={{ width: 44 }} /></colgroup>
          <thead><tr><th>Merchant</th><th>Category</th><th>Person</th><th>Type</th><th style={{ textAlign: "right" }}>Per month</th><th style={{ textAlign: "right" }}>Total</th><th style={{ textAlign: "right" }}>Txns</th><th></th></tr></thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.token}>
                <td>
                  <div className="td-clip">
                    {m.name
                      ? <Link className="amount-link" to={`/transactions?merchant=${encodeURIComponent(m.token)}`}>{m.name}</Link>
                      : <Link className="amount-link muted" style={{ fontStyle: "italic" }} to={`/transactions?merchant=${encodeURIComponent(m.token)}`}>Unnamed</Link>}
                  </div>
                  <div className="note-line" title="Bank statement line — not editable">{m.statement}</div>
                </td>
                <td><Combobox value={m.categoryKey} options={catOpts} allowClear placeholder="—" onChange={(v) => set(m.token, { categoryKey: v })} /></td>
                <td><Combobox value={m.personKey} options={personOpts} allowClear placeholder="—" onChange={(v) => set(m.token, { personKey: v })} /></td>
                <td><Combobox value={m.override} placeholder="Auto" options={[{ value: "auto", label: `Auto · ${TYPE_LABEL[m.detected]}` }, { value: "fixed", label: "Recurring" }, { value: "variable", label: "Variable" }, { value: "ignore", label: "Ignore" }]} onChange={(v) => set(m.token, { recurring: (v ?? "auto") as MerchantDTO["override"] })} /></td>
                <td className="num">{formatGBP(m.monthlyTypical)}</td>
                <td className="num">{formatGBP(m.totalSpent)}</td>
                <td className="num">{m.txnCount}</td>
                <td><button className="btn-sm" title="Edit merchant" onClick={() => openEdit(m)}>✎</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="muted">No merchants{tab !== "all" ? " in this view" : " yet — sync some transactions"}.</p>}
      </div>

      <dialog ref={dialog} className="modal" onClick={(e) => { if (e.target === dialog.current) dialog.current?.close(); }}>
        {edit && (
          <form className="modal-body" onSubmit={(e) => { e.preventDefault(); saveEdit(); }}>
            <h3 style={{ marginTop: 0 }}>Edit merchant</h3>
            <div className="note-line" style={{ marginTop: -6 }}>{edit.statement}</div>
            <label className="field"><span>Human-readable name</span><input value={form.name} autoFocus placeholder="e.g. Tesco" onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="field"><span>Category</span>
              <select value={edit.categoryKey ?? ""} onChange={(e) => { const v = e.target.value || null; set(edit.token, { categoryKey: v }); setEdit({ ...edit, categoryKey: v }); }}>
                <option value="">—</option>
                {catNames.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Person</span>
              <select value={edit.personKey ?? ""} onChange={(e) => { const v = e.target.value || null; set(edit.token, { personKey: v }); setEdit({ ...edit, personKey: v }); }}>
                <option value="">—</option>
                {people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Priority (higher wins)</span><input inputMode="numeric" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} /></label>
            <div className="modal-actions"><button type="button" onClick={() => dialog.current?.close()}>Cancel</button><button className="btn-primary" type="submit">Save</button></div>
          </form>
        )}
      </dialog>
    </div>
  );
}

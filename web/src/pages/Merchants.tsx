import { useMemo, useRef, useState } from "react";
import { useQueryState } from "nuqs";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Receipt } from "lucide-react";
import { api } from "../api.ts";
import type { MerchantDTO } from "../../../shared/types.ts";
import { formatGBP, formatMoney, relativeDate } from "../format.ts";
import { Combobox } from "../components/Combobox.tsx";
import { BrandLogo } from "../components/BrandLogo.tsx";
import { merchantLogo } from "../brand.ts";

const ccySym = (c: string | null) => (c === "USD" ? "$" : c === "EUR" ? "€" : "£");

const TABS: [string, string][] = [["all", "All"], ["fixed", "Recurring"], ["variable", "Variable"]];
const TYPE_LABEL: Record<string, string> = { fixed: "Recurring", variable: "Variable", oneoff: "One-off", ignore: "Ignored", auto: "Auto" };

export default function Merchants() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["merchants"], queryFn: () => api.merchants() });
  const catNames = (useQuery({ queryKey: ["categoryNames"], queryFn: () => api.categoryNames(), staleTime: 5 * 60_000 }).data ?? []);
  const people = (useQuery({ queryKey: ["people"], queryFn: () => api.people(), staleTime: 5 * 60_000 }).data ?? []);
  const [tab, setTab] = useQueryState("tab", { defaultValue: "all", history: "replace" });

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
  const editOrders = useQuery({ queryKey: ["merchantOrders", edit?.token], queryFn: () => api.merchantOrders(edit!.token), enabled: Boolean(edit && edit.orderCount > 0) });
  const [form, setForm] = useState({ name: "", domain: "", priority: "0" });
  const openEdit = (m: MerchantDTO) => { setEdit(m); setForm({ name: m.name ?? "", domain: m.domain ?? "", priority: String(m.priority) }); dialog.current?.showModal(); };
  const saveEdit = () => {
    if (!edit) return;
    set(edit.token, { name: form.name.trim() || null, domain: form.domain.trim() || null, priority: Number(form.priority) || 0 });
    dialog.current?.close();
  };

  const confirmDetected = useMutation({
    mutationFn: () => api.confirmDetectedMerchants(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["merchants"] }); qc.invalidateQueries({ queryKey: ["transactions"] }); },
  });
  const detectedCount = useMemo(() => (data?.merchants ?? []).filter((m) => m.categoryKey && !m.categoryFromRule).length, [data]);

  const shown = useMemo(() => (data?.merchants ?? []).filter((m) => tab === "all" || m.effective === tab), [data, tab]);

  return (
    <div>
      <div className="row-between">
        <h1>Merchants</h1>
        {detectedCount > 0 && <button onClick={() => confirmDetected.mutate()} disabled={confirmDetected.isPending} title="Save auto-detected categories as rules">Confirm {detectedCount} detected {detectedCount === 1 ? "category" : "categories"}</button>}
      </div>
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
          <colgroup><col /><col style={{ width: 160 }} /><col style={{ width: 120 }} /><col style={{ width: 140 }} /><col style={{ width: 64 }} /><col style={{ width: 100 }} /><col style={{ width: 96 }} /><col style={{ width: 56 }} /><col style={{ width: 44 }} /></colgroup>
          <thead><tr><th>Merchant</th><th>Category</th><th>Person</th><th>Type</th><th style={{ textAlign: "right" }}>Priority</th><th style={{ textAlign: "right" }}>Per month</th><th style={{ textAlign: "right" }}>Total</th><th style={{ textAlign: "right" }}>Txns</th><th></th></tr></thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.token}>
                <td>
                  <div className="merchant-cell">
                    <span className="merchant-logos">
                      <BrandLogo name={m.name ?? m.statement} src={merchantLogo(m.name, m.domain)} size={32} />
                      {m.accountLogo && <BrandLogo name={m.accountName ?? ""} src={m.accountLogo} size={18} />}
                    </span>
                    <div className="td-clip">
                      <div className="merchant-name-row">
                        {m.name
                          ? <Link className="amount-link td-clip" to={`/transactions?merchant=${encodeURIComponent(m.token)}`}>{m.name}</Link>
                          : <Link className="amount-link muted td-clip" style={{ fontStyle: "italic" }} to={`/transactions?merchant=${encodeURIComponent(m.token)}`}>Unnamed</Link>}
                        {m.orderCount > 0 && <span className="merchant-orders" title={`${m.orderCount} matched order${m.orderCount === 1 ? "" : "s"}`}><Receipt size={11} strokeWidth={2} />{m.orderCount}</span>}
                      </div>
                      <div className="note-line" title="Bank statement line — not editable">{m.statement}</div>
                    </div>
                  </div>
                </td>
                <td><Combobox value={m.categoryKey} options={catOpts} allowClear placeholder="—" onChange={(v) => set(m.token, { categoryKey: v })} /></td>
                <td><Combobox value={m.personKey} options={personOpts} allowClear placeholder="—" onChange={(v) => set(m.token, { personKey: v })} /></td>
                <td><Combobox value={m.override} placeholder="Auto" options={[{ value: "auto", label: `Auto · ${TYPE_LABEL[m.detected]}` }, { value: "fixed", label: "Recurring" }, { value: "variable", label: "Variable" }, { value: "ignore", label: "Ignore" }]} onChange={(v) => set(m.token, { recurring: (v ?? "auto") as MerchantDTO["override"] })} /></td>
                <td className="num">{m.priority}</td>
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
            <label className="field"><span>Statement line (from your bank — read-only)</span><input value={edit.statement} readOnly className="readonly" /></label>
            <label className="field"><span>Human-readable name</span><input value={form.name} autoFocus placeholder="e.g. Tesco" onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="field"><span>Brand domain (logo)</span>
              <span className="domain-field">
                <BrandLogo name={form.name || edit.statement} src={merchantLogo(form.name || null, form.domain || null)} size={26} />
                <input value={form.domain} placeholder="e.g. tesco.com" onChange={(e) => setForm({ ...form, domain: e.target.value })} />
              </span>
            </label>
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
            <label className="field"><span>Priority (higher wins) · {Number(form.priority) || 0}</span>
              <input type="range" min={0} max={100} value={Number(form.priority) || 0} className="prio-range"
                style={{ background: `linear-gradient(to right, var(--jade) ${Number(form.priority) || 0}%, var(--surface-2) ${Number(form.priority) || 0}%)` }}
                onChange={(e) => setForm({ ...form, priority: e.target.value })} />
            </label>
            {edit.orderCount > 0 && (
              <div className="field">
                <span>Recent orders · {edit.orderCount}</span>
                <div className="merchant-orders-list">
                  {(editOrders.data ?? []).slice(0, 8).map((o) => (
                    <div key={o.id} className="mo-row">
                      <span className="mo-main">{o.items.length ? o.items.slice(0, 3).map((i) => i.name).join(", ") + (o.items.length > 3 ? ` +${o.items.length - 3}` : "") : (o.subject ?? "Order")}</span>
                      <span className="mo-side">
                        <span className="num">{ccySym(o.currency)}{formatMoney(o.total ?? 0)}</span>
                        <span className="muted">{o.emailDate ? new Date(o.emailDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}</span>
                      </span>
                    </div>
                  ))}
                  {editOrders.isLoading && <div className="muted" style={{ padding: "8px 0" }}>Loading…</div>}
                </div>
              </div>
            )}
            <div className="modal-actions">
              {(edit.categoryKey || edit.personKey) && <button type="button" className="btn-danger" style={{ marginRight: "auto" }} onClick={() => { set(edit.token, { categoryKey: null, personKey: null }); dialog.current?.close(); }}>Remove rule</button>}
              <button type="button" onClick={() => dialog.current?.close()}>Cancel</button>
              <button className="btn-primary" type="submit">Save</button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}

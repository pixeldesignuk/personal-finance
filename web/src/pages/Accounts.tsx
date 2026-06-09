import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryState } from "nuqs";
import { api } from "../api.ts";
import type { BankDTO, AccountRecurringDTO } from "../../../shared/types.ts";
import { formatMoney } from "../format.ts";
import { BrandLogo } from "../components/BrandLogo.tsx";

// GoCardless requisition status codes → plain English.
const STATUS_LABEL: Record<string, string> = {
  LN: "Linked", CR: "Incomplete", GC: "Consent", UA: "Authenticating",
  SA: "Selecting", GA: "Granting", RJ: "Rejected", EX: "Expired",
  MANUAL: "Manual", INVESTMENT: "Investment", ASSET: "Asset", LIABILITY: "Debt",
};
const statusClass = (s: string) => (s === "LN" ? "pos" : s === "EX" || s === "RJ" ? "neg" : "");

// Which filter tab a group belongs to.
const kindOf = (status: string) =>
  status === "INVESTMENT" ? "investments" : status === "ASSET" ? "assets" : "accounts";
const TABS: [string, string][] = [["all", "All"], ["accounts", "Accounts"], ["investments", "Investments"], ["assets", "Assets"]];

type Kind = "MANUAL" | "ASSET";
const KIND_META: Record<Kind, { title: string; valueLabel: string }> = {
  MANUAL: { title: "Cash / manual account", valueLabel: "Current balance (£)" },
  ASSET: { title: "Asset", valueLabel: "Current value (£)" },
};

export default function Accounts() {
  const [banks, setBanks] = useState<BankDTO[]>([]);
  const [recurring, setRecurring] = useState<Record<string, AccountRecurringDTO>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [tab, setTab] = useQueryState("tab", { defaultValue: "all", history: "replace" });
  const navigate = useNavigate();

  const dialog = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<{ kind: Kind; name: string; type: "PERSONAL" | "BUSINESS"; value: string }>({ kind: "MANUAL", name: "", type: "PERSONAL", value: "0" });

  const load = () => api.accounts().then(setBanks).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    api.accountsRecurring()
      .then((rows) => setRecurring(Object.fromEntries(rows.map((r) => [r.accountId, r]))))
      .catch(() => setRecurring({}));
  }, []);
  const wrap = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); } catch (e) { setMsg((e as Error).message); } };

  const openAdd = (kind: Kind) => { setForm({ kind, name: "", type: "PERSONAL", value: "0" }); dialog.current?.showModal(); };
  const submitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setMsg("Enter a name"); return; }
    const value = /^-?\d+(\.\d+)?$/.test(form.value.trim()) ? form.value.trim() : "0";
    wrap(async () => { await api.createManualAccount({ name: form.name.trim(), type: form.type, source: form.kind, manualBalance: value }); dialog.current?.close(); });
  };

  const editBalance = (id: string, current: number, label: string) => {
    const bal = window.prompt(`New ${label} (£):`, String(current));
    if (bal === null) return;
    wrap(() => api.patchAccount(id, { manualBalance: bal }));
  };
  const rename = (id: string, current: string) => {
    const nickname = window.prompt("Nickname (blank to clear):", current);
    if (nickname === null) return;
    wrap(() => api.patchAccount(id, { nickname: nickname.trim() || null }));
  };
  const toggleType = (id: string, type: string) => wrap(() => api.patchAccount(id, { type: type === "PERSONAL" ? "BUSINESS" : "PERSONAL" }));
  const setBalanceType = (id: string, value: string) => wrap(() => api.patchAccount(id, { balanceType: value || null }));
  const removeManual = (id: string, name: string) => { if (window.confirm(`Delete ${name}?`)) wrap(() => api.deleteManualAccount(id)); };
  const removeBank = (requisitionId: string, name: string) => { if (window.confirm(`Remove ${name}? Deletes its stored transactions/balances.`)) wrap(() => api.removeBank(requisitionId)); };
  const reconnect = (institutionId: string) => api.connect(institutionId).then(({ link }) => { window.location.href = link; }).catch((e) => setMsg(e.message));

  const shown = useMemo(() => banks.filter((b) => b.status !== "LIABILITY" && (tab === "all" || kindOf(b.status) === tab)), [banks, tab]);
  // Flatten to self-contained account cards; the tabs do the grouping, not headers.
  const cards = useMemo(() => shown.flatMap((bank) => bank.accounts.map((a) => ({ bank, a }))), [shown]);
  const isManualish = (s: string) => ["MANUAL", "ASSET", "LIABILITY"].includes(s);

  return (
    <div>
      <div className="row-between">
        <h1>Manage accounts</h1>
        <div className="toolbar">
          <button onClick={() => openAdd("MANUAL")}>Add cash</button>
          <button onClick={() => openAdd("ASSET")}>Add asset</button>
          <button className="btn-primary" onClick={() => navigate("/connect")}>Add bank</button>
        </div>
      </div>
      {msg && <p className="muted">{msg}</p>}

      <div className="tabs">
        {TABS.map(([key, label]) => (
          <button key={key} className={`tab${tab === key ? " active" : ""}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {cards.length === 0 && <div className="card"><p className="muted">Nothing here yet.</p></div>}
      <div className="grid acct-cards">
        {cards.map(({ bank, a }) => (
          <div className="card acct-card" key={a.id}>
            <div className="acct-card-meta">
              <span className="acct-inst-wrap">
                <BrandLogo name={bank.institutionName} src={bank.institutionLogo} size={22} />
                <span className="acct-inst">{bank.institutionName}</span>
              </span>
              <span className={`badge ${statusClass(bank.status)}`}>{STATUS_LABEL[bank.status] ?? bank.status}</span>
            </div>
            <div className="acct-card-head">
              <span className="acct-name">{a.displayName}</span>
              <button className="chip" title="Toggle personal / business" onClick={() => toggleType(a.id, a.type)}>{a.type}</button>
            </div>
            <div className="acct-card-figure">
              <span className="eyebrow acct-card-label">{a.source === "LIABILITY" ? "Owed" : a.source === "ASSET" ? "Value" : "Balance"}</span>
              <span className={`acct-card-bal ${a.source === "LIABILITY" ? "neg" : ""}`}>
                <span className="ccy">{a.currency ?? "GBP"}</span> {formatMoney(a.currentBalance)}
              </span>
            </div>
            {recurring[a.id] && (
              <span className="acct-maintain" title={`Recurring out of this account:\n${recurring[a.id].items.map((i) => `· ${i.name} — £${formatMoney(i.monthly)}`).join("\n")}`}>
                <span className="dot" aria-hidden /> maintain ~£{formatMoney(recurring[a.id].recurringMonthly)}/mo
              </span>
            )}
            {a.source === "BANK" && a.balances.length > 1 && (
              <select className="select-xs" value={a.balanceType ?? ""} onChange={(e) => setBalanceType(a.id, e.target.value)} title="Which GoCardless balance figure to display">
                <option value="">auto</option>
                {a.balances.map((b) => <option key={b.type} value={b.type}>{b.type} · {b.amount}</option>)}
              </select>
            )}
            <div className="acct-card-actions">
              <button className="btn-sm" onClick={() => rename(a.id, a.nickname ?? "")}>Rename</button>
              {isManualish(a.source) && <button className="btn-sm" onClick={() => editBalance(a.id, a.source === "LIABILITY" ? -a.currentBalance : a.currentBalance, a.source === "LIABILITY" ? "amount owed" : a.source === "ASSET" ? "value" : "balance")}>Set {a.source === "LIABILITY" ? "owed" : a.source === "ASSET" ? "value" : "balance"}</button>}
              {isManualish(a.source) && <button className="btn-danger btn-sm" onClick={() => removeManual(a.id, a.displayName)}>Delete</button>}
              {a.source === "BANK" && <button className="btn-sm" onClick={() => reconnect(bank.institutionId)}>Reconnect</button>}
              {a.source === "BANK" && <button className="btn-danger btn-sm" onClick={() => removeBank(bank.requisitionId, bank.institutionName)}>Remove</button>}
            </div>
          </div>
        ))}
      </div>

      <dialog ref={dialog} className="modal" onClick={(e) => { if (e.target === dialog.current) dialog.current?.close(); }}>
        <form className="modal-body" onSubmit={submitAdd}>
          <h3 style={{ marginTop: 0 }}>Add {KIND_META[form.kind].title}</h3>
          <label className="field"><span>Kind</span>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}>
              <option value="MANUAL">Cash / manual</option>
              <option value="ASSET">Asset (house, car…)</option>
            </select>
          </label>
          <label className="field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus placeholder={form.kind === "ASSET" ? "e.g. House" : "e.g. Cash"} /></label>
          <label className="field"><span>{KIND_META[form.kind].valueLabel}</span><input inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></label>
          {form.kind === "MANUAL" && (
            <label className="field"><span>Account type</span>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as "PERSONAL" | "BUSINESS" })}>
                <option value="PERSONAL">Personal</option><option value="BUSINESS">Business</option>
              </select>
            </label>
          )}
          <div className="modal-actions"><button type="button" onClick={() => dialog.current?.close()}>Cancel</button><button className="btn-primary" type="submit">Add</button></div>
        </form>
      </dialog>
    </div>
  );
}

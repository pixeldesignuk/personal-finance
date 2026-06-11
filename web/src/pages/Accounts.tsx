import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wallet } from "lucide-react";
import { api } from "../api.ts";
import type { BankDTO, AccountDTO, AccountRecurringDTO } from "../../../shared/types.ts";
import { formatMoney } from "../format.ts";
import { BrandLogo } from "../components/BrandLogo.tsx";
import { CardMenu } from "../components/CardMenu.tsx";
import { PageHeader, EmptyState, Modal, Field, useConfirm } from "../components/ui";

const numOk = (s: string) => /^-?\d+(\.\d+)?$/.test(s.trim());

export default function Accounts() {
  const [banks, setBanks] = useState<BankDTO[]>([]);
  const [recurring, setRecurring] = useState<Record<string, AccountRecurringDTO>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const navigate = useNavigate();
  const confirm = useConfirm();

  const load = () => api.accounts().then(setBanks).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    api.accountsRecurring().then((rows) => setRecurring(Object.fromEntries(rows.map((r) => [r.accountId, r])))).catch(() => setRecurring({}));
  }, []);
  const wrap = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); } catch (e) { setMsg((e as Error).message); } };

  // Add-cash dialog.
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<{ name: string; type: "PERSONAL" | "BUSINESS"; value: string }>({ name: "", type: "PERSONAL", value: "0" });
  const openAdd = () => { setAddForm({ name: "", type: "PERSONAL", value: "0" }); setAddOpen(true); };
  const submitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.name.trim()) { setMsg("Enter a name"); return; }
    const value = numOk(addForm.value) ? addForm.value.trim() : "0";
    wrap(async () => { await api.createManualAccount({ name: addForm.name.trim(), type: addForm.type, source: "MANUAL", manualBalance: value }); setAddOpen(false); });
  };

  // Edit-value dialog (rename / set balance).
  const [edit, setEdit] = useState<{ kind: "rename" | "balance"; id: string; label: string } | null>(null);
  const [editVal, setEditVal] = useState("");
  const openRename = (a: AccountDTO) => { setEdit({ kind: "rename", id: a.id, label: a.displayName }); setEditVal(a.nickname ?? ""); };
  const openBalance = (a: AccountDTO) => { setEdit({ kind: "balance", id: a.id, label: a.displayName }); setEditVal(String(a.currentBalance)); };
  const submitEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    if (edit.kind === "rename") wrap(() => api.patchAccount(edit.id, { nickname: editVal.trim() || null }));
    else wrap(() => api.patchAccount(edit.id, { manualBalance: numOk(editVal) ? editVal.trim() : "0" }));
    setEdit(null);
  };

  const toggleType = (a: AccountDTO) => wrap(() => api.patchAccount(a.id, { type: a.type === "PERSONAL" ? "BUSINESS" : "PERSONAL" }));
  const setBalanceType = (id: string, value: string) => wrap(() => api.patchAccount(id, { balanceType: value || null }));
  const reconnect = async (institutionId: string) => {
    if (!(await confirm({
      title: "Reconnect for more history?",
      body: "You'll re-approve access at your bank. We'll request the longest history your bank allows (up to 2 years) and pull it in — your existing transactions, categories and budgets are kept.",
      confirmLabel: "Reconnect",
    }))) return;
    try { const { link } = await api.connect(institutionId); window.location.href = link; }
    catch (e) { setMsg((e as Error).message); }
  };
  const deleteCash = async (a: AccountDTO) => {
    if (await confirm({ title: `Delete ${a.displayName}?`, body: "This removes the cash account and its manual transactions.", danger: true })) wrap(() => api.deleteManualAccount(a.id));
  };
  const removeBank = async (bank: BankDTO) => {
    if (await confirm({ title: `Remove ${bank.institutionName}?`, body: "Deletes its stored transactions & balances.", confirmLabel: "Remove bank", danger: true })) wrap(() => api.removeBank(bank.requisitionId));
  };

  // Banks + cash only — investments, assets and debts have their own spaces.
  const cards = useMemo(
    () => banks.filter((b) => !["INVESTMENT", "ASSET", "LIABILITY"].includes(b.status)).flatMap((bank) => bank.accounts.map((a) => ({ bank, a }))),
    [banks],
  );

  return (
    <div>
      <PageHeader
        title="Accounts"
        subtitle="Your bank & cash accounts. Investments, assets and debts live under Wealth."
        actions={<>
          <button onClick={openAdd}>Add cash</button>
          <button className="btn-primary" onClick={() => navigate("/connect")}>Add bank</button>
        </>}
      />
      {msg && <p className="muted">{msg}</p>}

      {cards.length === 0 && <EmptyState>No accounts yet — connect a bank or add cash.</EmptyState>}
      <div className="grid acct-cards">
        {cards.map(({ bank, a }) => {
          const isCash = a.source === "MANUAL";
          return (
            <div className="card acct-card" key={a.id}>
              <div className="acct-card-meta">
                <span className="acct-inst-wrap">
                  {isCash
                    ? <span className="acct-cash-ico"><Wallet size={13} strokeWidth={2} /></span>
                    : <BrandLogo name={bank.institutionName} src={bank.institutionLogo} size={22} />}
                  <span className="acct-inst">{isCash ? "Cash" : bank.institutionName}</span>
                  {a.type === "BUSINESS" && <span className="acct-biz">Business</span>}
                </span>
                <CardMenu>
                  <button type="button" onClick={() => openRename(a)}>Rename</button>
                  {isCash && <button type="button" onClick={() => openBalance(a)}>Set balance</button>}
                  {isCash && <button type="button" onClick={() => toggleType(a)}>Mark as {a.type === "PERSONAL" ? "business" : "personal"}</button>}
                  {a.source === "BANK" && a.balances.length > 1 && (
                    <>
                      <div className="card-menu-label">Balance figure</div>
                      <button type="button" className={a.balanceType ? "" : "sel"} onClick={() => setBalanceType(a.id, "")}>Auto</button>
                      {a.balances.map((b) => <button type="button" key={b.type} className={a.balanceType === b.type ? "sel" : ""} onClick={() => setBalanceType(a.id, b.type)}>{b.type} · {b.amount}</button>)}
                    </>
                  )}
                  {a.source === "BANK" && <button type="button" title="Re-approve at your bank and pull the longest history available" onClick={() => reconnect(bank.institutionId)}>Reconnect for more history</button>}
                  {isCash && <button type="button" className="danger" onClick={() => deleteCash(a)}>Delete</button>}
                  {a.source === "BANK" && <button type="button" className="danger" onClick={() => removeBank(bank)}>Remove bank</button>}
                </CardMenu>
              </div>
              <div className="acct-card-head">
                <span className="acct-name">{a.displayName}</span>
              </div>
              <div className="acct-card-figure">
                <span className="eyebrow acct-card-label">Balance</span>
                <span className="acct-card-bal"><span className="ccy">{a.currency ?? "GBP"}</span> {formatMoney(a.currentBalance)}</span>
              </div>
              {recurring[a.id] && (
                <span className="acct-maintain" title={`Recurring out of this account:\n${recurring[a.id].items.map((i) => `· ${i.name} — £${formatMoney(i.monthly)}`).join("\n")}`}>
                  <span className="dot" aria-hidden /> maintain ~£{formatMoney(recurring[a.id].recurringMonthly)}/mo
                </span>
              )}
            </div>
          );
        })}
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)}>
        <form className="modal-body" onSubmit={submitAdd}>
          <h3>Add cash account</h3>
          <Field label="Name"><input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} autoFocus placeholder="e.g. Wallet, Savings jar" /></Field>
          <Field label="Current balance (£)"><input inputMode="decimal" value={addForm.value} onChange={(e) => setAddForm({ ...addForm, value: e.target.value })} /></Field>
          <Field label="Type">
            <select value={addForm.type} onChange={(e) => setAddForm({ ...addForm, type: e.target.value as "PERSONAL" | "BUSINESS" })}>
              <option value="PERSONAL">Personal</option><option value="BUSINESS">Business</option>
            </select>
          </Field>
          <div className="modal-actions"><button type="button" onClick={() => setAddOpen(false)}>Cancel</button><button className="btn-primary" type="submit">Add</button></div>
        </form>
      </Modal>

      <Modal open={edit != null} onClose={() => setEdit(null)} size="sm">
        {edit && (
          <form className="modal-body" onSubmit={submitEdit}>
            <h3>{edit.kind === "rename" ? "Rename" : "Set balance"} · {edit.label}</h3>
            <Field label={edit.kind === "rename" ? "Nickname (blank to clear)" : "Balance (£)"}>
              <input value={editVal} autoFocus inputMode={edit.kind === "balance" ? "decimal" : undefined} onChange={(e) => setEditVal(e.target.value)} />
            </Field>
            <div className="modal-actions"><button type="button" onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary" type="submit">Save</button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}

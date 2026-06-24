import { useEffect, useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import { api } from "../api.ts";
import type { BankDTO, AccountDTO, AccountRecurringDTO } from "../../../shared/types.ts";
import { formatMoney } from "../format.ts";
import { providerMeta, providerLogoCandidates, KIND_LABEL } from "../../../shared/investmentMeta.ts";
import { BrandLogo } from "../components/BrandLogo.tsx";
import { CardMenu } from "../components/CardMenu.tsx";
import { AddAccountModal } from "../components/AddAccountModal.tsx";
import { PageHeader, EmptyState, Modal, Field, Toggle, useConfirm } from "../components/ui";

const numOk = (s: string) => /^-?\d+(\.\d+)?$/.test(s.trim());

export default function Accounts() {
  const [banks, setBanks] = useState<BankDTO[]>([]);
  const [recurring, setRecurring] = useState<Record<string, AccountRecurringDTO>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const confirm = useConfirm();

  const load = () => api.accounts().then(setBanks).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    api.accountsRecurring().then((rows) => setRecurring(Object.fromEntries(rows.map((r) => [r.accountId, r])))).catch(() => setRecurring({}));
  }, []);
  const wrap = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); } catch (e) { setMsg((e as Error).message); } };

  // Unified add-account modal (bank / cash / investment).
  const [addOpen, setAddOpen] = useState(false);

  // Investment account actions.
  const syncInvestment = (a: AccountDTO) => wrap(() => api.syncInvestmentAccount(a.id));
  const disconnectInvestment = async (a: AccountDTO) => {
    if (await confirm({ title: `Disconnect ${a.displayName}?`, body: "Removes the investment account and its holdings. Your API keys are deleted.", confirmLabel: "Disconnect", danger: true })) wrap(() => api.deleteManualAccount(a.id));
  };

  // Rename dialog.
  const [edit, setEdit] = useState<{ id: string; label: string } | null>(null);
  const [editVal, setEditVal] = useState("");
  const openRename = (a: AccountDTO) => { setEdit({ id: a.id, label: a.displayName }); setEditVal(a.nickname ?? ""); };
  const submitEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    wrap(() => api.patchAccount(edit.id, { nickname: editVal.trim() || null }));
    setEdit(null);
  };

  // Account settings dialog — balance figure, exclude-from-budget, funds-not-mine,
  // and (for cash) the balance — all in one tidy place instead of crowding the menu.
  const [settingsFor, setSettingsFor] = useState<AccountDTO | null>(null);
  const [sForm, setSForm] = useState({ balanceType: "", informational: false, creditCard: false, excluded: "", balance: "" });
  const openSettings = (a: AccountDTO) => {
    setSForm({ balanceType: a.balanceType ?? "", informational: a.informational, creditCard: a.isCreditCard, excluded: a.excludedBalance ? String(a.excludedBalance) : "", balance: String(a.currentBalance) });
    setSettingsFor(a);
  };
  const saveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    const a = settingsFor;
    if (!a) return;
    const patch: Parameters<typeof api.patchAccount>[1] = {};
    if ((a.balanceType ?? "") !== sForm.balanceType) patch.balanceType = sForm.balanceType || null;
    if (a.informational !== sForm.informational) patch.informational = sForm.informational;
    if (a.isCreditCard !== sForm.creditCard) patch.creditCard = sForm.creditCard;
    const excluded = sForm.excluded.trim();
    if (excluded !== (a.excludedBalance ? String(a.excludedBalance) : "")) patch.excludedBalance = numOk(excluded) && Number(excluded) > 0 ? excluded : null;
    if (a.source === "MANUAL" && numOk(sForm.balance) && Number(sForm.balance) !== a.currentBalance) patch.manualBalance = sForm.balance.trim();
    if (Object.keys(patch).length) wrap(() => api.patchAccount(a.id, patch));
    setSettingsFor(null);
  };
  // Reconnect dialog: re-approve at the bank and choose how much history to pull
  // (defaults to the maximum the bank allows).
  const [reconnectFor, setReconnectFor] = useState<{ institutionId: string; name: string } | null>(null);
  const [historyChoice, setHistoryChoice] = useState("max");
  const openReconnect = (institutionId: string, name: string) => { setHistoryChoice("max"); setReconnectFor({ institutionId, name }); };
  const submitReconnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reconnectFor) return;
    const days = historyChoice === "max" ? undefined : Number(historyChoice);
    try { const { link } = await api.connect(reconnectFor.institutionId, days); window.location.href = link; }
    catch (e) { setMsg((e as Error).message); setReconnectFor(null); }
  };
  const deleteCash = async (a: AccountDTO) => {
    if (await confirm({ title: `Delete ${a.displayName}?`, body: "This removes the cash account and its manual transactions.", danger: true })) wrap(() => api.deleteManualAccount(a.id));
  };
  const removeBank = async (bank: BankDTO) => {
    if (await confirm({ title: `Remove ${bank.institutionName}?`, body: "Deletes its stored transactions & balances.", confirmLabel: "Remove bank", danger: true })) wrap(() => api.removeBank(bank.requisitionId));
  };

  // Banks + cash + investments — assets and debts keep their own spaces.
  const cards = useMemo(
    () => banks.filter((b) => !["ASSET", "LIABILITY"].includes(b.status)).flatMap((bank) => bank.accounts.map((a) => ({ bank, a }))),
    [banks],
  );

  return (
    <div>
      <PageHeader
        title="Accounts"
        subtitle="Your bank, cash & investment accounts. Assets and debts live under Wealth."
        actions={<button className="btn-primary" onClick={() => setAddOpen(true)}>Add account</button>}
      />
      {msg && <p className="muted">{msg}</p>}

      {cards.length === 0 && <EmptyState>No accounts yet — connect a bank or add cash.</EmptyState>}
      <div className="grid acct-cards">
        {cards.map(({ bank, a }) => {
          const isCash = a.source === "MANUAL";
          const isInvestment = a.source === "INVESTMENT";
          const meta = isInvestment ? providerMeta(a.provider) : null;
          const instLabel = isInvestment ? (meta ? KIND_LABEL[meta.kind] : "Investment") : isCash ? "Cash" : bank.institutionName;
          return (
            <div className="card acct-card" key={a.id}>
              <div className="acct-card-meta">
                <span className="acct-inst-wrap">
                  {isInvestment
                    ? <BrandLogo name={meta?.label ?? a.displayName} src={meta ? providerLogoCandidates(meta.domain) : null} size={22} />
                    : isCash
                    ? <span className="acct-cash-ico"><Wallet size={13} strokeWidth={2} /></span>
                    : <BrandLogo name={bank.institutionName} src={bank.institutionLogo} size={22} />}
                  <span className="acct-inst">{instLabel}</span>
                  {a.type === "BUSINESS" && <span className="acct-biz">Business</span>}
                  {a.informational && <span className="acct-biz" title="In net worth, but excluded from income, spending & budgeting">Not budgeted</span>}
                </span>
                <CardMenu>
                  <button type="button" onClick={() => openRename(a)}>Rename</button>
                  {(a.source === "BANK" || isCash) && <button type="button" onClick={() => openSettings(a)}>Settings…</button>}
                  {a.source === "BANK" && <button type="button" title="Re-approve at your bank and pull more transaction history" onClick={() => openReconnect(bank.institutionId, bank.institutionName)}>Reconnect</button>}
                  {isInvestment && <button type="button" onClick={() => syncInvestment(a)}>Sync now</button>}
                  {isInvestment && <button type="button" className="danger" onClick={() => disconnectInvestment(a)}>Disconnect</button>}
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
                {a.informational && (
                  <span className="acct-excluded" title="Counts toward net worth, but its transactions are kept out of your income, spending & safe-to-spend">in net worth · excluded from budget</span>
                )}
                {a.excludedBalance ? (
                  a.currentBalance < a.excludedBalance ? (
                    <span className="acct-excluded warn" title="The balance has fallen below the funds you're holding for others — you've dipped into money that isn't yours. Your net worth reflects the shortfall.">
                      ⚠ £{formatMoney(a.excludedBalance - a.currentBalance)} dipped into funds not yours
                    </span>
                  ) : (
                    <span className="acct-excluded" title="Held for others — excluded from net worth">
                      −£{formatMoney(a.excludedBalance)} not yours · £{formatMoney(a.currentBalance - a.excludedBalance)} in net worth
                    </span>
                  )
                ) : null}
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

      <AddAccountModal open={addOpen} onClose={() => setAddOpen(false)} onAdded={load} />

      <Modal open={edit != null} onClose={() => setEdit(null)} size="sm">
        {edit && (
          <form className="modal-body" onSubmit={submitEdit}>
            <h3>Rename · {edit.label}</h3>
            <Field label="Nickname (blank to clear)">
              <input value={editVal} autoFocus onChange={(e) => setEditVal(e.target.value)} />
            </Field>
            <div className="modal-actions"><button type="button" onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary" type="submit">Save</button></div>
          </form>
        )}
      </Modal>

      <Modal open={settingsFor != null} onClose={() => setSettingsFor(null)} size="sm">
        {settingsFor && (
          <form className="modal-body" onSubmit={saveSettings}>
            <h3>Settings · {settingsFor.displayName}</h3>
            {settingsFor.source === "MANUAL" && (
              <Field label="Balance (£)" hint="Logged cash transactions adjust this automatically.">
                <input inputMode="decimal" value={sForm.balance} onChange={(e) => setSForm({ ...sForm, balance: e.target.value })} />
              </Field>
            )}
            {settingsFor.source === "BANK" && settingsFor.balances.length > 1 && (
              <Field label="Balance figure" hint="Which of the bank's balance figures to use.">
                <select value={sForm.balanceType} onChange={(e) => setSForm({ ...sForm, balanceType: e.target.value })}>
                  <option value="">Auto</option>
                  {settingsFor.balances.map((b) => <option key={b.type} value={b.type}>{b.type} · {b.amount}</option>)}
                </select>
              </Field>
            )}
            <div className="settings-toggle">
              <Toggle checked={sForm.informational} onChange={(v) => setSForm({ ...sForm, informational: v })} label="Exclude from budget" />
              <p className="muted settings-hint">Kept in net worth, but left out of income, spending & safe-to-spend. For shared / non-personal accounts.</p>
            </div>
            {settingsFor.source === "BANK" && (
              <div className="settings-toggle">
                <Toggle checked={sForm.creditCard} onChange={(v) => setSForm({ ...sForm, creditCard: v })} label="Credit card" />
                <p className="muted settings-hint">In account health, a negative balance is treated as card debt, not an overdraft.</p>
              </div>
            )}
            <Field label="Funds not mine (£)" hint="A fixed amount held for someone else — carved out of net worth. Leave blank or 0 if none.">
              <input inputMode="decimal" value={sForm.excluded} placeholder="0.00" onChange={(e) => setSForm({ ...sForm, excluded: e.target.value })} />
            </Field>
            <div className="modal-actions"><button type="button" onClick={() => setSettingsFor(null)}>Cancel</button><button className="btn-primary" type="submit">Save</button></div>
          </form>
        )}
      </Modal>

      <Modal open={reconnectFor != null} onClose={() => setReconnectFor(null)} size="sm">
        {reconnectFor && (
          <form className="modal-body" onSubmit={submitReconnect}>
            <h3>Reconnect · {reconnectFor.name}</h3>
            <p className="muted" style={{ marginTop: -4 }}>You'll re-approve access at your bank. Your existing transactions, categories and budgets are kept — we just pull more history.</p>
            <Field label="Transaction history">
              <select value={historyChoice} autoFocus onChange={(e) => setHistoryChoice(e.target.value)}>
                <option value="max">Maximum available (recommended)</option>
                <option value="730">Last 2 years</option>
                <option value="365">Last 12 months</option>
                <option value="180">Last 6 months</option>
                <option value="90">Last 90 days</option>
              </select>
            </Field>
            <p className="muted" style={{ fontSize: 12, marginTop: -2 }}>Banks cap how far back they share — you'll get up to your choice, whichever is less.</p>
            <div className="modal-actions"><button type="button" onClick={() => setReconnectFor(null)}>Cancel</button><button className="btn-primary" type="submit">Reconnect</button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}

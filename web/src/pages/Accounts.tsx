import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, CATEGORY_OPTIONS } from "../api.ts";
import type { BankDTO } from "../../../shared/types.ts";
import { formatMoney } from "../format.ts";

export default function Accounts() {
  const [banks, setBanks] = useState<BankDTO[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = () => api.accounts().then(setBanks).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);

  const wrap = async (fn: () => Promise<unknown>) => {
    try { await fn(); await load(); } catch (e) { setMsg((e as Error).message); }
  };

  const addManual = () => {
    const name = window.prompt("Account name (e.g. Cash, Trading 212):");
    if (!name) return;
    const isBiz = window.confirm("Is this a BUSINESS account? OK = business, Cancel = personal.");
    const bal = window.prompt("Current balance (£):", "0") ?? "0";
    wrap(() => api.createManualAccount({ name, type: isBiz ? "BUSINESS" : "PERSONAL", manualBalance: bal }));
  };

  const editBalance = (id: string, current: number) => {
    const bal = window.prompt("New balance (£):", String(current));
    if (bal === null) return;
    wrap(() => api.patchAccount(id, { manualBalance: bal }));
  };

  const rename = (id: string, current: string) => {
    const nickname = window.prompt("Nickname (blank to clear):", current);
    if (nickname === null) return;
    wrap(() => api.patchAccount(id, { nickname: nickname.trim() || null }));
  };

  const toggleType = (id: string, type: string) =>
    wrap(() => api.patchAccount(id, { type: type === "PERSONAL" ? "BUSINESS" : "PERSONAL" }));

  const addTxn = (accountId: string) => {
    const date = window.prompt("Date (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
    if (!date) return;
    const amount = window.prompt("Amount (negative for spending, e.g. -12.50):");
    if (!amount) return;
    const category = window.prompt(`Category (${CATEGORY_OPTIONS.join(", ")}):`, "other") ?? "other";
    wrap(() => api.createTxn({ accountId, date, amount, category }));
  };

  const removeManual = (id: string, name: string) => {
    if (!window.confirm(`Delete ${name} and its manual transactions?`)) return;
    wrap(() => api.deleteManualAccount(id));
  };

  const removeBank = (requisitionId: string, name: string) => {
    if (!window.confirm(`Remove ${name}? Deletes its stored transactions/balances.`)) return;
    wrap(() => api.removeBank(requisitionId));
  };

  const reconnect = (institutionId: string) =>
    api.connect(institutionId).then(({ link }) => { window.location.href = link; }).catch((e) => setMsg(e.message));

  return (
    <div>
      <div className="row-between">
        <h1>Manage accounts</h1>
        <div className="toolbar">
          <button onClick={addManual}>Add cash / manual</button>
          <button className="btn-primary" onClick={() => navigate("/connect")}>Add bank</button>
        </div>
      </div>
      {msg && <p className="muted">{msg}</p>}
      {banks.map((bank) => (
        <div className="card" key={bank.requisitionId}>
          <div className="row-between">
            <h3 style={{ margin: 0 }}>
              {bank.institutionName}{" "}
              <span className={`badge ${bank.status === "LN" ? "pos" : ""}`}>{bank.status}</span>
            </h3>
            {bank.requisitionId !== "manual" && (
              <div className="toolbar">
                <button className="btn-sm" onClick={() => reconnect(bank.institutionId)}>Reconnect</button>
                <button className="btn-danger btn-sm" onClick={() => removeBank(bank.requisitionId, bank.institutionName)}>Remove</button>
              </div>
            )}
          </div>
          <table style={{ marginTop: 10 }}>
            <thead><tr><th>Account</th><th>Type</th><th>Balance</th><th></th></tr></thead>
            <tbody>
              {bank.accounts.map((a) => (
                <tr key={a.id}>
                  <td>{a.displayName}</td>
                  <td>
                    <button className="btn-sm" onClick={() => toggleType(a.id, a.type)}>{a.type}</button>
                  </td>
                  <td className="num">{a.currency ?? "GBP"} {formatMoney(a.currentBalance)}</td>
                  <td style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button className="btn-sm" onClick={() => rename(a.id, a.nickname ?? "")}>Rename</button>
                    {a.source === "MANUAL" && <button className="btn-sm" onClick={() => editBalance(a.id, a.currentBalance)}>Set balance</button>}
                    {a.source === "MANUAL" && <button className="btn-sm" onClick={() => addTxn(a.id)}>Add txn</button>}
                    {a.source === "MANUAL" && <button className="btn-danger btn-sm" onClick={() => removeManual(a.id, a.displayName)}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

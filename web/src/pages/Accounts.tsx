import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.ts";
import type { BankDTO } from "../../../shared/types.ts";

export default function Accounts() {
  const [banks, setBanks] = useState<BankDTO[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = () => api.accounts().then(setBanks).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);

  const rename = async (id: string, current: string) => {
    const nickname = window.prompt("Nickname for this account (blank to clear):", current);
    if (nickname === null) return;
    try {
      await api.setNickname(id, nickname.trim() || null);
      await load();
    } catch (e) { setMsg((e as Error).message); }
  };

  const reconnect = async (institutionId: string) => {
    try {
      const { link } = await api.connect(institutionId);
      window.location.href = link;
    } catch (e) { setMsg((e as Error).message); }
  };

  const remove = async (requisitionId: string, name: string) => {
    if (!window.confirm(`Remove ${name}? This deletes its stored transactions and balances.`)) return;
    try {
      const r = await api.removeBank(requisitionId);
      setMsg(r.remoteDeleted ? "Removed." : "Removed locally; bank link may persist at GoCardless.");
      await load();
    } catch (e) { setMsg((e as Error).message); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Manage accounts</h1>
        <button onClick={() => navigate("/connect")}>Add another bank</button>
      </div>
      {msg && <p>{msg}</p>}
      <p style={{ color: "#6b7280", fontSize: 13 }}>
        Reconnecting a bank may add new account entries (the bank issues new IDs); remove the old ones if so.
      </p>
      {banks.length === 0 && <p>No banks connected yet.</p>}
      {banks.map((bank) => (
        <div className="card" key={bank.requisitionId}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>
              {bank.institutionName}{" "}
              <span style={{ fontSize: 12, color: bank.status === "LN" ? "#16a34a" : "#dc2626" }}>
                ({bank.status})
              </span>
            </h3>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => reconnect(bank.institutionId)}>Reconnect</button>
              <button
                style={{ background: "#dc2626" }}
                onClick={() => remove(bank.requisitionId, bank.institutionName)}
              >
                Remove
              </button>
            </div>
          </div>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Account</th><th>Balance</th><th></th></tr></thead>
            <tbody>
              {bank.accounts.map((a) => (
                <tr key={a.id}>
                  <td>{a.displayName}</td>
                  <td>
                    {a.balances.length
                      ? a.balances.map((b) => `${b.currency} ${b.amount}`).join(" / ")
                      : "—"}
                  </td>
                  <td><button onClick={() => rename(a.id, a.nickname ?? "")}>Rename</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, CATEGORY_OPTIONS } from "../api.ts";
import type { TransactionDTO, BankDTO } from "../../../shared/types.ts";
import { formatMoney } from "../format.ts";
import { AccountSelector } from "../components/AccountSelector.tsx";

export default function Transactions() {
  const [params] = useSearchParams();
  const accountId = params.get("account") ?? undefined;
  const [rows, setRows] = useState<TransactionDTO[]>([]);
  const [banks, setBanks] = useState<BankDTO[]>([]);
  const [q, setQ] = useState("");

  const loadBanks = () => api.accounts().then(setBanks).catch(() => setBanks([]));
  useEffect(() => { loadBanks(); }, []);

  const load = () => api.transactions(q, accountId).then(setRows).catch(() => setRows([]));
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [q, accountId]);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    banks.forEach((b) => b.accounts.forEach((a) => m.set(a.id, a.displayName)));
    return m;
  }, [banks]);

  const setCategory = async (id: string, category: string) => {
    try { await api.setTxnCategory(id, category); await load(); } catch { /* ignore */ }
  };
  const del = async (id: string) => {
    if (!window.confirm("Delete this manual transaction?")) return;
    try { await api.deleteTxn(id); await load(); } catch { /* ignore */ }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Transactions</h1>
        <AccountSelector />
      </div>
      <input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card" style={{ marginTop: 16 }}>
        <table>
          <thead><tr><th>Date</th><th>Account</th><th>Name</th><th>Category</th><th>Amount</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.bookingDate ?? ""}</td>
                <td>{nameById.get(r.accountId) ?? r.accountId.slice(-4)}</td>
                <td>{r.name ?? r.remittanceInfo ?? ""}</td>
                <td>
                  <select value={r.category} onChange={(e) => setCategory(r.id, e.target.value)}>
                    {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td style={{ color: Number(r.amount) < 0 ? "#dc2626" : "#16a34a" }}>{r.currency} {formatMoney(r.amount)}</td>
                <td>{r.source === "MANUAL" && <button style={{ background: "#dc2626" }} onClick={() => del(r.id)}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.ts";
import type { TransactionDTO, BankDTO } from "../../../shared/types.ts";
import { formatMoney } from "../format.ts";
import { AccountSelector } from "../components/AccountSelector.tsx";
import { AddTransaction } from "../components/AddTransaction.tsx";

export default function Transactions() {
  const [params] = useSearchParams();
  const accountId = params.get("account") ?? undefined;
  const [rows, setRows] = useState<TransactionDTO[]>([]);
  const [banks, setBanks] = useState<BankDTO[]>([]);
  const [q, setQ] = useState("");

  const loadBanks = () => api.accounts().then(setBanks).catch(() => setBanks([]));
  useEffect(() => { loadBanks(); }, []);

  const [catNames, setCatNames] = useState<{ key: string; name: string }[]>([]);
  const [people, setPeople] = useState<{ key: string; name: string }[]>([]);
  useEffect(() => { api.categoryNames().then(setCatNames).catch(() => setCatNames([])); api.people().then(setPeople).catch(() => setPeople([])); }, []);

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
  const setPerson = async (id: string, personKey: string | null) => { try { await api.setTxnPerson(id, personKey); await load(); } catch { /* ignore */ } };
  const del = async (id: string) => {
    if (!window.confirm("Delete this manual transaction?")) return;
    try { await api.deleteTxn(id); await load(); } catch { /* ignore */ }
  };

  return (
    <div>
      <div className="row-between">
        <h1>Transactions</h1>
        <AccountSelector />
      </div>
      <AddTransaction onAdded={load} />
      <input placeholder="Search transactions…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
      <div className="card" style={{ marginTop: 16 }}>
        <table>
          <thead><tr><th>Date</th><th>Account</th><th>Name</th><th>Category</th><th>Person</th><th>Amount</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.bookingDate ?? ""}</td>
                <td>
                  {nameById.get(r.accountId) ?? r.accountId.slice(-4)}
                  {r.source === "MANUAL" && <span className="badge manual" style={{ marginLeft: 8 }}>manual</span>}
                </td>
                <td>{r.name ?? r.remittanceInfo ?? ""}</td>
                <td>
                  <select value={r.category} onChange={(e) => setCategory(r.id, e.target.value)}>
                    {catNames.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                  </select>
                </td>
                <td>
                  <select value={r.personKey ?? ""} onChange={(e) => setPerson(r.id, e.target.value || null)}>
                    <option value="">—</option>
                    {people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
                  </select>
                </td>
                <td className={`num ${Number(r.amount) < 0 ? "neg" : "pos"}`}>{r.currency} {formatMoney(r.amount)}</td>
                <td>{r.source === "MANUAL" && <button className="btn-danger btn-sm" onClick={() => del(r.id)}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.ts";
import type { TransactionDTO, BankDTO } from "../../../shared/types.ts";
import { AccountSelector } from "../components/AccountSelector.tsx";

export default function Transactions() {
  const [params] = useSearchParams();
  const accountId = params.get("account") ?? undefined;
  const [rows, setRows] = useState<TransactionDTO[]>([]);
  const [banks, setBanks] = useState<BankDTO[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => { api.accounts().then(setBanks).catch(() => setBanks([])); }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api.transactions(q, accountId).then(setRows).catch(() => setRows([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, accountId]);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    banks.forEach((bank) => bank.accounts.forEach((a) => m.set(a.id, a.displayName)));
    return m;
  }, [banks]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Transactions</h1>
        <AccountSelector />
      </div>
      <input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card" style={{ marginTop: 16 }}>
        <table>
          <thead><tr><th>Date</th><th>Account</th><th>Name</th><th>Category</th><th>Amount</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.bookingDate ?? ""}</td>
                <td>{nameById.get(r.accountId) ?? r.accountId.slice(-4)}</td>
                <td>{r.name ?? r.remittanceInfo ?? ""}</td>
                <td>{r.category}</td>
                <td style={{ color: Number(r.amount) < 0 ? "#dc2626" : "#16a34a" }}>{r.currency} {r.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

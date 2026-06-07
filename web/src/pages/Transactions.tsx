import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { TransactionDTO } from "../../../shared/types.ts";

export default function Transactions() {
  const [rows, setRows] = useState<TransactionDTO[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    const t = setTimeout(() => { api.transactions(q).then(setRows).catch(() => setRows([])); }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div>
      <h1>Transactions</h1>
      <input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card" style={{ marginTop: 16 }}>
        <table>
          <thead><tr><th>Date</th><th>Name</th><th>Category</th><th>Amount</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.bookingDate ?? ""}</td>
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

import { useEffect, useState } from "react";
import { api, CATEGORY_OPTIONS } from "../api.ts";
import type { BankDTO, AccountDTO } from "../../../shared/types.ts";

export function AddTransaction({ onAdded }: { onAdded: () => void }) {
  const [manual, setManual] = useState<AccountDTO[]>([]);
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("other");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.accounts().then((banks: BankDTO[]) => {
      const m = banks.flatMap((b) => b.accounts).filter((a) => a.source === "MANUAL");
      setManual(m);
      if (m[0]) setAccountId(m[0].id);
    }).catch(() => setManual([]));
  }, []);

  if (manual.length === 0) {
    return <div className="card"><span className="muted">Add a cash / manual account on <a href="/accounts">Manage</a> to log transactions here.</span></div>;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^-?\d+(\.\d+)?$/.test(amount)) { setMsg("Enter a number (negative for spending)"); return; }
    try {
      await api.createTxn({ accountId, date, amount, category, note: note || undefined });
      setAmount(""); setNote(""); setMsg(null);
      onAdded();
    } catch (err) { setMsg((err as Error).message); }
  };

  return (
    <form className="card" onSubmit={submit} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
        {manual.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
      </select>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "auto" }} />
      <input placeholder="-12.50" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 110 }} />
      <select value={category} onChange={(e) => setCategory(e.target.value)}>
        {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <input placeholder="note (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 120 }} />
      <button className="btn-primary" type="submit">Add</button>
      {msg && <span className="neg" style={{ width: "100%" }}>{msg}</span>}
    </form>
  );
}

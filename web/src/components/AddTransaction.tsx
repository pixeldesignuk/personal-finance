import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import type { BankDTO, AccountDTO } from "../../../shared/types.ts";

export function AddTransaction({ onAdded }: { onAdded: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [manual, setManual] = useState<AccountDTO[]>([]);
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [sign, setSign] = useState<"-" | "+">("-");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("uncategorised");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [catNames, setCatNames] = useState<{ key: string; name: string }[]>([]);

  useEffect(() => {
    api.accounts().then((banks: BankDTO[]) => {
      const m = banks.flatMap((b) => b.accounts).filter((a) => a.source === "MANUAL");
      setManual(m);
      setAccountId((prev) => prev || (m[0]?.id ?? ""));
    }).catch(() => setManual([]));
  }, []);

  useEffect(() => { api.categoryNames().then(setCatNames).catch(() => setCatNames([])); }, []);
  useEffect(() => { if (catNames[0]) setCategory((p) => p === "uncategorised" ? catNames[0].key : p); }, [catNames]);

  const noAccounts = manual.length === 0;
  const open = () => { setMsg(null); dialogRef.current?.showModal(); };
  const close = () => dialogRef.current?.close();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = amount.trim();
    if (!/^\d+(\.\d+)?$/.test(raw)) { setMsg("Enter an amount, e.g. 12.50"); return; }
    const signed = (sign === "-" ? "-" : "") + raw;
    try {
      await api.createTxn({ accountId, date, amount: signed, category, note: note || undefined });
      setAmount(""); setNote(""); setMsg(null);
      close();
      onAdded();
    } catch (err) { setMsg((err as Error).message); }
  };

  return (
    <>
      <button
        className="btn-primary"
        onClick={noAccounts ? () => { window.location.href = "/accounts"; } : open}
        title={noAccounts ? "Create a cash / manual account first" : "Add a manual transaction"}
      >
        + Add transaction
      </button>

      <dialog ref={dialogRef} className="modal" onClick={(e) => { if (e.target === dialogRef.current) close(); }}>
        <form className="modal-body" onSubmit={submit}>
          <h3 style={{ marginTop: 0 }}>Add transaction</h3>

          <label className="field">
            <span>Account</span>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {manual.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
            </select>
          </label>

          <div style={{ display: "flex", gap: 12 }}>
            <label className="field" style={{ flex: 1 }}>
              <span>Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>Direction</span>
              <select value={sign} onChange={(e) => setSign(e.target.value as "-" | "+")}>
                <option value="-">Spend</option>
                <option value="+">Income</option>
              </select>
            </label>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <label className="field" style={{ flex: 1 }}>
              <span>Amount (£)</span>
              <input placeholder="0.00" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {catNames.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
              </select>
            </label>
          </div>

          <label className="field">
            <span>Note</span>
            <input placeholder="optional" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>

          {msg && <p className="neg" style={{ margin: 0 }}>{msg}</p>}

          <div className="modal-actions">
            <button type="button" onClick={close}>Cancel</button>
            <button className="btn-primary" type="submit">Add transaction</button>
          </div>
        </form>
      </dialog>
    </>
  );
}

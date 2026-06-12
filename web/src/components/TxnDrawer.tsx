import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Paperclip } from "lucide-react";
import type { TransactionDTO, CategoryNameDTO, PersonDTO } from "../../../shared/types.ts";
import { formatMoney } from "../format.ts";
import { Combobox, type ComboOption } from "./Combobox.tsx";

const FLAGS: { key: string | null; label: string }[] = [
  { key: null, label: "None" },
  { key: "red", label: "Red" },
  { key: "orange", label: "Orange" },
  { key: "yellow", label: "Yellow" },
];

// Right-hand detail/edit sidebar for a single transaction. Surfaces everything
// the list row hides — line items, the receipt image, the raw statement line,
// origin/status — and lets you edit the name, category, person, note and flag.
export function TxnDrawer({
  txn, onClose, catNames, people, liabilities, debtName, nameOptions,
  onRename, onCategory, onPerson, onNote, onFlag, onDelete, onLinkDebt, onUnlinkDebt,
}: {
  txn: TransactionDTO;
  onClose: () => void;
  catNames: CategoryNameDTO[];
  people: PersonDTO[];
  liabilities: { id: string; displayName: string }[];
  debtName: (id: string) => string;
  nameOptions: (name: string | null) => ComboOption[];
  onRename: (name: string) => void;
  onCategory: (key: string) => void;
  onPerson: (key: string | null) => void;
  onNote: (note: string | null) => void;
  onFlag: (flag: string | null) => void;
  onDelete: () => void;
  onLinkDebt: (debtId: string) => void;
  onUnlinkDebt: () => void;
}) {
  const [note, setNote] = useState(txn.note ?? "");
  useEffect(() => { setNote(txn.note ?? ""); }, [txn.id, txn.note]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const neg = Number(txn.amount) < 0;
  const date = txn.bookingDate ? new Date(`${txn.bookingDate}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric" }) : "—";
  const originLabel = { bank: "Bank sync", telegram: "Telegram", receipt: "Telegram receipt", manual: "Manual" }[txn.origin];
  const commitNote = () => { const v = note.trim(); if ((v || null) !== (txn.note ?? null)) onNote(v || null); };

  return createPortal(
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer txn-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <span className="sheet-title">Transaction</span>
          <button className="btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="drawer-body">
          <div className="txnd-amount">
            <span className={`num ${neg ? "neg" : "pos"}`}>{txn.currency} {formatMoney(txn.amount)}</span>
            <span className="muted txnd-sub">{date} · {txn.accountName}{originLabel ? ` · ${originLabel}` : ""}</span>
          </div>

          <div className="drawer-section">
            <div className="eyebrow">Merchant</div>
            <Combobox value={txn.name?.trim() || txn.remittanceInfo?.trim() || null} options={nameOptions(txn.name?.trim() || txn.remittanceInfo?.trim() || null)} allowCustom placeholder="Add name" onChange={(v) => v && onRename(v)} />
          </div>

          <div className="drawer-section txnd-grid">
            <label className="txnd-field"><span className="eyebrow">Category</span>
              <select value={txn.category} onChange={(e) => onCategory(e.target.value)}>
                {catNames.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
              </select>
            </label>
            <label className="txnd-field"><span className="eyebrow">Person</span>
              <select value={txn.personKey ?? ""} onChange={(e) => onPerson(e.target.value || null)}>
                <option value="">—</option>
                {people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
              </select>
            </label>
          </div>

          <div className="drawer-section">
            <div className="eyebrow">Note</div>
            <input className="note-input" value={note} placeholder="Add a note…" onChange={(e) => setNote(e.target.value)} onBlur={commitNote}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          </div>

          <div className="drawer-section">
            <div className="eyebrow">Flag for reduction</div>
            <div className="txnd-flags">
              {FLAGS.map((f) => (
                <button key={f.label} className={`btn-sm${(txn.flag ?? null) === f.key ? ` flag-${f.key ?? "none"} sel` : ""}`} onClick={() => onFlag(f.key)}>{f.label}</button>
              ))}
            </div>
          </div>

          {txn.order && (txn.order.items.length > 0 || txn.order.hasAttachment) && (
            <div className="drawer-section">
              <div className="eyebrow">Receipt{txn.order.items.length > 0 ? ` · ${txn.order.items.length} items` : ""}</div>
              {txn.order.hasAttachment && (
                <button className="btn-sm txnd-receipt" onClick={() => window.open(`/api/orders/${txn.order!.id}/file`, "_blank", "noopener")}>
                  <Paperclip size={13} strokeWidth={1.9} /> View receipt image
                </button>
              )}
              {txn.order.items.length > 0 && (
                <ul className="txnd-items">
                  {txn.order.items.map((it, i) => (
                    <li key={i}><span className="td-clip">{it.qty ? `${it.qty}× ` : ""}{it.name}</span>{it.price != null && <span className="num muted">{formatMoney(it.price)}</span>}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {txn.remittanceInfo && txn.remittanceInfo.trim() !== (txn.name ?? "").trim() && (
            <div className="drawer-section">
              <div className="eyebrow">Statement line</div>
              <p className="muted txnd-raw">{txn.remittanceInfo}</p>
            </div>
          )}

          <div className="drawer-section txnd-actions">
            {txn.debtAccountId ? (
              <button className="btn-sm" onClick={onUnlinkDebt}>Unlink repayment ({debtName(txn.debtAccountId)})</button>
            ) : liabilities.length > 0 ? (
              <label className="txnd-field"><span className="eyebrow">Link as debt repayment</span>
                <select value="" onChange={(e) => { if (e.target.value) onLinkDebt(e.target.value); }}>
                  <option value="">— choose a debt —</option>
                  {liabilities.map((l) => <option key={l.id} value={l.id}>{l.displayName}</option>)}
                </select>
              </label>
            ) : null}
            {txn.source === "MANUAL" && <button className="btn-danger btn-sm" onClick={onDelete}>Delete transaction</button>}
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

import { Receipt } from "lucide-react";
import { formatMoney, ccySymbol } from "../format.ts";

export interface OrderItem { name: string; qty?: number | null; price?: number | null }

// The shared body of an order-detail modal — used both on the Orders page
// (from a parsed email) and on Transactions (from a matched transaction's
// order). Render inside a `<Modal>`.
export function OrderDetail({ merchant, orderNumber, dateISO, total, currency, isRefund, tags, items, attachmentHref, onClose }: {
  merchant: string;
  orderNumber?: string | null;
  dateISO?: string | null;
  total?: number | null;
  currency?: string | null;
  isRefund?: boolean;
  tags?: string[];
  items: OrderItem[];
  attachmentHref?: string | null;
  onClose: () => void;
}) {
  const sym = ccySymbol(currency);
  const dateLabel = dateISO ? new Date(dateISO).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  return (
    <div className="modal-body">
      <div className="order-detail-head">
        <span className={`plugin-icon${isRefund ? " refund" : ""}`}><Receipt size={18} strokeWidth={1.9} /></span>
        <div className="plugin-title">
          <h3>{merchant}{isRefund && <span className="order-refund-tag">refund</span>}</h3>
          <span className="muted">{orderNumber ? `Order ${orderNumber}` : "Order"}{dateLabel ? ` · ${dateLabel}` : ""}</span>
        </div>
        {total != null && <span className="num order-detail-total">{isRefund ? "+" : ""}{sym}{formatMoney(total)}</span>}
      </div>
      {tags && tags.length > 0 && <div className="order-tags-row">{tags.map((t) => <span key={t} className="order-tag-pill">{t}</span>)}</div>}
      {items.length > 0 ? (
        <ul className="order-items-list">
          {items.map((it, i) => (
            <li key={i}>
              <span className="order-item-name">{it.qty && it.qty > 1 ? `${it.qty}× ` : ""}{it.name}</span>
              {it.price != null && <span className="num muted">{sym}{formatMoney(it.price)}</span>}
            </li>
          ))}
        </ul>
      ) : <p className="empty">No line items captured.</p>}
      <div className="modal-actions">
        {attachmentHref && <a className="amount-link" href={attachmentHref} target="_blank" rel="noreferrer" style={{ marginRight: "auto" }}>View receipt ↗</a>}
        <button type="button" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

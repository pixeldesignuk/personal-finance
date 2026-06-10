import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { Receipt } from "lucide-react";
import { api } from "../api.ts";
import type { EmailOrderDTO } from "../../../shared/types.ts";
import { formatMoney } from "../format.ts";

const TABS: [string, string][] = [["all", "All"], ["matched", "Matched"], ["unmatched", "Unmatched"], ["refunds", "Refunds"]];
const ccy = (c: string | null) => (c === "USD" ? "$" : c === "EUR" ? "€" : "£");

export default function Orders() {
  const [tab, setTab] = useQueryState("tab", { defaultValue: "all", history: "replace" });
  const [q, setQ] = useQueryState("q", { defaultValue: "", history: "replace" });
  const [debounced, setDebounced] = useState(q);
  // debounce search
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onSearch = (v: string) => { setQ(v); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setDebounced(v), 250); };

  const { data } = useQuery({ queryKey: ["orders", tab, debounced], queryFn: () => api.gmailOrders(debounced, tab) });
  const orders = data ?? [];

  const dialog = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<EmailOrderDTO | null>(null);
  const open = (o: EmailOrderDTO) => { setView(o); dialog.current?.showModal(); };

  return (
    <div>
      <div className="row-between">
        <h1>Orders</h1>
        <input className="orders-search" placeholder="Search merchant, item, tag, order #…" value={q} onChange={(e) => onSearch(e.target.value)} />
      </div>
      <p className="muted" style={{ marginTop: -6 }}>Purchases parsed from your email and matched to transactions. <a href="/plugins">Manage Gmail →</a></p>

      <div className="tabs">{TABS.map(([k, l]) => <button key={k} className={`tab${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>{l}</button>)}</div>

      <div className="card">
        {orders.length === 0 && <p className="muted">No orders{q ? " match your search" : tab !== "all" ? " in this view" : " yet — sync Gmail from the Plugins page"}.</p>}
        {orders.map((o) => (
          <button key={o.id} className="order-row order-row-btn" onClick={() => open(o)}>
            <span className="order-lead">
              <span className={`order-icon${o.isRefund ? " refund" : ""}`}><Receipt size={15} strokeWidth={1.9} /></span>
              <span className="order-main">
                <span className="order-merchant">{o.merchantName ?? o.subject ?? "Order"}{o.isRefund && <span className="order-refund-tag">refund</span>}</span>
                <span className="order-items muted">
                  {o.items.length ? o.items.slice(0, 3).map((i) => i.name).join(", ") + (o.items.length > 3 ? ` +${o.items.length - 3}` : "") : (o.tags.join(", ") || o.subject || "")}
                </span>
              </span>
            </span>
            <span className="order-side">
              {o.tags.slice(0, 2).map((t) => <span key={t} className="order-tag-pill">{t}</span>)}
              <span className={`badge ${o.matched ? "pos" : ""}`}>{o.matched ? "matched" : "unmatched"}</span>
              <span className={`num${o.isRefund ? " pos" : ""}`}>{o.isRefund ? "+" : ""}{ccy(o.currency)}{formatMoney(o.total ?? 0)}</span>
              <span className="muted order-date">{o.emailDate ? new Date(o.emailDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}</span>
            </span>
          </button>
        ))}
      </div>

      <dialog ref={dialog} className="modal" onClick={(e) => { if (e.target === dialog.current) dialog.current?.close(); }}>
        {view && (
          <div className="modal-body">
            <div className="order-detail-head">
              <span className={`plugin-icon${view.isRefund ? " refund" : ""}`}><Receipt size={18} strokeWidth={1.9} /></span>
              <div className="plugin-title">
                <h3 style={{ margin: 0 }}>{view.merchantName ?? view.subject ?? "Order"}{view.isRefund && <span className="order-refund-tag">refund</span>}</h3>
                <span className="muted">{view.orderNumber ? `Order ${view.orderNumber}` : "Order"}{view.emailDate ? ` · ${new Date(view.emailDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}</span>
              </div>
              {view.total != null && <span className="num order-detail-total">{view.isRefund ? "+" : ""}{ccy(view.currency)}{formatMoney(view.total)}</span>}
            </div>
            {view.tags.length > 0 && <div className="order-tags-row">{view.tags.map((t) => <span key={t} className="order-tag-pill">{t}</span>)}</div>}
            {view.items.length > 0 ? (
              <ul className="order-items-list">
                {view.items.map((it, i) => (
                  <li key={i}>
                    <span className="order-item-name">{it.qty && it.qty > 1 ? `${it.qty}× ` : ""}{it.name}</span>
                    {it.price != null && <span className="num muted">{ccy(view.currency)}{formatMoney(it.price)}</span>}
                  </li>
                ))}
              </ul>
            ) : <p className="muted">No line items captured.</p>}
            <div className="modal-actions"><button type="button" onClick={() => dialog.current?.close()}>Close</button></div>
          </div>
        )}
      </dialog>
    </div>
  );
}

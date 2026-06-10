import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { Receipt } from "lucide-react";
import { api } from "../api.ts";
import type { EmailOrderDTO } from "../../../shared/types.ts";
import { formatMoney, ccySymbol } from "../format.ts";
import { PageHeader, Tabs, Modal, MatchBadge, type TabItem } from "../components/ui";
import { OrderDetail } from "../components/OrderDetail.tsx";

const TABS: TabItem[] = [{ key: "all", label: "All" }, { key: "matched", label: "Matched" }, { key: "unmatched", label: "Unmatched" }, { key: "refunds", label: "Refunds" }];

export default function Orders() {
  const [tab, setTab] = useQueryState("tab", { defaultValue: "all", history: "replace" });
  const [q, setQ] = useQueryState("q", { defaultValue: "", history: "replace" });
  const [debounced, setDebounced] = useState(q);
  // debounce search
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onSearch = (v: string) => { setQ(v); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setDebounced(v), 250); };

  const { data } = useQuery({ queryKey: ["orders", tab, debounced], queryFn: () => api.gmailOrders(debounced, tab) });
  const orders = data ?? [];

  const [view, setView] = useState<EmailOrderDTO | null>(null);

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle={<>Purchases parsed from your email and matched to transactions. <a href="/plugins">Manage Gmail →</a></>}
        actions={<input className="orders-search" placeholder="Search merchant, item, tag, order #…" value={q} onChange={(e) => onSearch(e.target.value)} />}
      />

      <Tabs value={tab} onChange={setTab} items={TABS} />

      <div className="card">
        {orders.length === 0 && <p className="empty">No orders{q ? " match your search" : tab !== "all" ? " in this view" : " yet — sync Gmail from the Plugins page"}.</p>}
        {orders.map((o) => (
          <button key={o.id} className="order-row order-row-btn" onClick={() => setView(o)}>
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
              <MatchBadge matched={o.matched} />
              <span className={`num${o.isRefund ? " pos" : ""}`}>{o.isRefund ? "+" : ""}{ccySymbol(o.currency)}{formatMoney(o.total ?? 0)}</span>
              <span className="muted order-date">{o.emailDate ? new Date(o.emailDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}</span>
            </span>
          </button>
        ))}
      </div>

      <Modal open={view != null} onClose={() => setView(null)}>
        {view && (
          <OrderDetail
            merchant={view.merchantName ?? view.subject ?? "Order"}
            orderNumber={view.orderNumber}
            dateISO={view.emailDate}
            total={view.total}
            currency={view.currency}
            isRefund={view.isRefund}
            tags={view.tags}
            items={view.items}
            onClose={() => setView(null)}
          />
        )}
      </Modal>
    </div>
  );
}

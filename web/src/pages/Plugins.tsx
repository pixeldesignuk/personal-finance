import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Mail } from "lucide-react";
import { api } from "../api.ts";
import type { AuditEvent } from "../../../shared/types.ts";
import { formatMoney } from "../format.ts";
import { useToast } from "../components/Toasts.tsx";
import { AuditSheet } from "../components/AuditSheet.tsx";

const money = (n: number | null, ccy: string | null) =>
  n == null ? "" : `${ccy === "USD" ? "$" : ccy === "EUR" ? "€" : "£"}${formatMoney(n)}`;

export default function Plugins() {
  const qc = useQueryClient();
  const { notify } = useToast();
  const { data } = useQuery({ queryKey: ["plugins"], queryFn: () => api.plugins() });
  const ordersQuery = useQuery({ queryKey: ["gmailOrders"], queryFn: () => api.gmailOrders(), enabled: Boolean(data?.gmail.connected) });
  const runsQuery = useQuery({ queryKey: ["syncRuns"], queryFn: () => api.syncRuns() });
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    const g = params.get("gmail");
    if (!g) return;
    if (g === "connected") notify("Gmail connected", { tone: "success" });
    else if (g === "denied") notify("Gmail connection cancelled", { tone: "error" });
    params.delete("gmail");
    setParams(params, { replace: true });
    qc.invalidateQueries({ queryKey: ["plugins"] });
  }, [params, setParams, notify, qc]);

  const disconnect = useMutation({
    mutationFn: () => api.disconnectGmail(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["plugins"] }); notify("Gmail disconnected"); },
  });

  const [syncOpen, setSyncOpen] = useState(false);
  const syncRun = useCallback((onEvent: (e: AuditEvent) => void) => api.gmailSyncStream(onEvent), []);
  const onSyncDone = () => {
    qc.invalidateQueries({ queryKey: ["plugins"] });
    qc.invalidateQueries({ queryKey: ["gmailOrders"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["syncRuns"] });
  };
  const runs = runsQuery.data ?? [];
  const summaryText = (s: unknown) => {
    if (!s || typeof s !== "object") return "";
    return Object.entries(s as Record<string, unknown>)
      .filter(([, v]) => typeof v === "number")
      .map(([k, v]) => `${v} ${k.replace(/([A-Z])/g, " $1").toLowerCase()}`)
      .join(" · ");
  };

  const g = data?.gmail;
  const orders = ordersQuery.data ?? [];

  return (
    <div>
      <h1>Plugins</h1>
      <p className="muted" style={{ marginTop: -6 }}>Connect external services to enrich your finances.</p>

      <div className="grid">
        <div className="card plugin-card">
          <div className="plugin-head">
            <span className="plugin-icon"><Mail size={20} strokeWidth={1.9} /></span>
            <div className="plugin-title">
              <h3 style={{ margin: 0 }}>Gmail</h3>
              <span className="muted">Match order &amp; receipt emails to your transactions.</span>
            </div>
            {g?.connected && <span className="badge pos plugin-status">Connected</span>}
          </div>

          {!g ? (
            <p className="muted">Loading…</p>
          ) : !g.available ? (
            <p className="muted">Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> to enable this plugin.</p>
          ) : g.connected ? (
            <>
              <div className="plugin-meta">
                <div><span className="eyebrow">Account</span><span>{g.email}</span></div>
                <div><span className="eyebrow">Orders</span><span>{g.orders} found · {g.matched} matched</span></div>
                <div><span className="eyebrow">Last sync</span><span>{g.lastSyncAt ? new Date(g.lastSyncAt).toLocaleString("en-GB") : "never"}</span></div>
              </div>
              <div className="plugin-actions">
                <button className="btn-primary" disabled={syncOpen} onClick={() => setSyncOpen(true)}>Sync now</button>
                <button className="btn-danger btn-sm" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>Disconnect</button>
              </div>
            </>
          ) : (
            <div className="plugin-actions">
              <button className="btn-primary" onClick={() => { window.location.href = "/api/plugins/gmail/connect"; }}>Connect Gmail</button>
            </div>
          )}
        </div>
      </div>

      {g?.connected && (
        <div className="card">
          <div className="row-between" style={{ marginBottom: 6 }}>
            <h3 style={{ margin: 0 }}>Recent orders</h3>
            <Link to="/orders" className="amount-link">View all →</Link>
          </div>
          {orders.length === 0 && <p className="muted">No orders parsed yet — hit “Sync now”.</p>}
          {orders.slice(0, 6).map((o) => (
            <div key={o.id} className="lrow order-row">
              <div className="order-main">
                <span className="order-merchant">{o.merchantName ?? o.subject ?? "Order"}{o.isRefund && <span className="order-refund-tag">refund</span>}</span>
                {o.items.length > 0 && <span className="order-items muted">{o.items.slice(0, 3).map((i) => i.name).join(", ")}{o.items.length > 3 ? ` +${o.items.length - 3} more` : ""}</span>}
              </div>
              <div className="order-side">
                <span className={`badge ${o.matched ? "pos" : ""}`}>{o.matched ? "matched" : "unmatched"}</span>
                <span className="num">{money(o.total, o.currency)}</span>
                <span className="muted order-date">{o.emailDate ? new Date(o.emailDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h3>Recent syncs</h3>
        {runs.length === 0 && <p className="muted">No syncs recorded yet.</p>}
        {runs.slice(0, 12).map((r) => (
          <div key={r.id} className="lrow run-row">
            <span className="run-main">
              <span className={`run-dot run-${r.status}`} />
              <span className="run-source">{r.source}</span>
              <span className="muted run-summary">{r.error ?? summaryText(r.summary)}</span>
            </span>
            <span className="muted run-time">{new Date(r.startedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        ))}
      </div>

      <AuditSheet open={syncOpen} title="Gmail sync" run={syncRun} onClose={() => setSyncOpen(false)} onDone={onSyncDone} />
    </div>
  );
}

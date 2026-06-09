import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Mail } from "lucide-react";
import { api } from "../api.ts";
import { useToast } from "../components/Toasts.tsx";

export default function Plugins() {
  const qc = useQueryClient();
  const { notify } = useToast();
  const { data } = useQuery({ queryKey: ["plugins"], queryFn: () => api.plugins() });
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

  const g = data?.gmail;
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
    </div>
  );
}

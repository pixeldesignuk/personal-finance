import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.ts";
import { formatMoney, formatGBP } from "../format.ts";
import { useToast } from "../components/Toasts.tsx";

const qty = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 6 });

export default function Investments() {
  const qc = useQueryClient();
  const { notify, update } = useToast();
  const { data } = useQuery({ queryKey: ["investments"], queryFn: () => api.investments() });

  const syncMut = useMutation({
    mutationFn: () => api.syncInvestments(),
    onMutate: () => ({ tid: notify("Syncing investments…", { tone: "loading", duration: 0 }) }),
    onSuccess: (r, _v, ctx) => {
      const total = r.results.reduce((s, x) => s + x.total, 0);
      const msg = r.results.length ? `Synced ${r.results.length} account${r.results.length === 1 ? "" : "s"} — £${formatMoney(total)}` : "No providers configured.";
      if (ctx) update(ctx.tid, msg, { tone: r.results.length ? "success" : "error" });
      qc.invalidateQueries({ queryKey: ["investments"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
    },
    onError: (e: Error, _v, ctx) => { if (ctx) update(ctx.tid, e.message, { tone: "error" }); },
  });
  const anyConfigured = data?.providers.some((p) => p.configured) ?? false;

  const total = data?.total ?? 0;
  const invested = data?.accounts.reduce((s, a) => s + a.invested, 0) ?? 0;
  const cash = data?.accounts.reduce((s, a) => s + a.cash, 0) ?? 0;
  const pnl = data?.accounts.reduce((s, a) => s + a.pnl, 0) ?? 0;

  return (
    <div>
      <div className="row-between">
        <h1>Investments</h1>
        <div className="toolbar">
          <button className="btn-primary" disabled={!anyConfigured || syncMut.isPending} onClick={() => syncMut.mutate()}
            title={anyConfigured ? "Sync all configured providers" : "No provider API keys set"}>
            {syncMut.isPending ? "Syncing…" : "Sync all"}
          </button>
        </div>
      </div>

      {data && (
        <div className="grid">
          <div className="card stat"><span className="label">Total value</span><span className="value">{formatGBP(total)}</span></div>
          <div className="card stat"><span className="label">Invested</span><span className="value">{formatGBP(invested)}</span></div>
          <div className="card stat"><span className="label">Cash</span><span className="value">{formatGBP(cash)}</span></div>
          <div className="card stat"><span className="label">Unrealised P/L</span><span className={`value ${pnl < 0 ? "neg" : "pos"}`}>{formatGBP(pnl)}</span></div>
        </div>
      )}

      {data?.accounts.length === 0 && (
        <div className="card"><p className="muted">
          No investments synced yet.{" "}
          {data.providers.some((p) => p.configured) ? "Hit a Sync button above." : "Add a provider API key (e.g. TRADING212_API_KEY) to .env, then Sync."}
        </p></div>
      )}

      {data?.accounts.map((a) => (
        <div className="card" key={a.id}>
          <div className="row-between" style={{ marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>{a.name}</h3>
            <span className="num">{formatGBP(a.total)} <span className="muted">· {a.holdings.length} holdings</span></span>
          </div>
          <table>
            <thead><tr><th>Holding</th><th style={{ textAlign: "right" }}>Qty</th><th style={{ textAlign: "right" }}>Price</th><th style={{ textAlign: "right" }}>Value</th><th style={{ textAlign: "right" }}>P/L</th></tr></thead>
            <tbody>
              {a.holdings.map((h) => (
                <tr key={h.symbol}>
                  <td>{h.name} <span className="muted" style={{ fontSize: 12 }}>{h.symbol}</span></td>
                  <td className="num">{qty(h.quantity)}</td>
                  <td className="num">{h.currency ?? ""} {formatMoney(h.price)}</td>
                  <td className="num">{formatGBP(h.value)}</td>
                  <td className={`num ${(h.pnl ?? 0) < 0 ? "neg" : "pos"}`}>{h.pnl == null ? "—" : formatGBP(h.pnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

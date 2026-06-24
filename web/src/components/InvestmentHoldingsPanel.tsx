import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.ts";
import { formatGBP } from "../format.ts";
import { providerMeta, KIND_LABEL } from "../../../shared/investmentMeta.ts";
import { useConfirm } from "./ui";

const fmtQty = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(q < 1 ? 6 : 4).replace(/0+$/, "").replace(/\.$/, ""));

// A drawer (portalled to document.body, per the transformed-ancestor overlay
// gotcha) showing one investment account's holdings + P/L, with sync/disconnect.
// Tapped from an investment chip in the accounts strip; investments have no health
// verdict, so this stands in for the bank/cash health panel.
export function InvestmentHoldingsPanel({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<null | "sync" | "disconnect">(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { data, isLoading } = useQuery({ queryKey: ["investments"], queryFn: () => api.investments() });
  const acct = data?.accounts.find((a) => a.id === accountId);
  const meta = providerMeta(acct?.provider);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["investments"] });
    qc.invalidateQueries({ queryKey: ["accounts"] });
    qc.invalidateQueries({ queryKey: ["summary"] });
  };
  const syncNow = async () => {
    setBusy("sync");
    try { await api.syncInvestmentAccount(accountId); refresh(); } finally { setBusy(null); }
  };
  const disconnect = async () => {
    if (!await confirm({ title: `Disconnect ${acct?.name ?? "this account"}?`, body: "Removes the investment account and its holdings. Your API keys are deleted.", confirmLabel: "Disconnect", danger: true })) return;
    setBusy("disconnect");
    try { await api.deleteManualAccount(accountId); refresh(); onClose(); } finally { setBusy(null); }
  };

  return createPortal(
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer inv-panel" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <span className="sheet-title">
            {acct?.name ?? "Investments"}
            {meta && <span className={`inv-kind-badge kind-${meta.kind}`}>{KIND_LABEL[meta.kind]}</span>}
          </span>
          <button className="btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="drawer-body">
          {isLoading && <p className="empty">Loading holdings…</p>}
          {!isLoading && !acct && <p className="empty">No holdings found for this account.</p>}
          {acct && (
            <>
              <div className="inv-panel-stats">
                <div className="inv-stat"><span className="inv-stat-lbl">Total value</span><span className="inv-stat-val num">{formatGBP(acct.total)}</span></div>
                <div className="inv-stat"><span className="inv-stat-lbl">Invested</span><span className="inv-stat-val num">{formatGBP(acct.invested)}</span></div>
                <div className="inv-stat"><span className="inv-stat-lbl">Cash</span><span className="inv-stat-val num">{formatGBP(acct.cash)}</span></div>
                <div className="inv-stat"><span className="inv-stat-lbl">Unrealised P/L</span><span className={`inv-stat-val num ${acct.pnl < 0 ? "neg" : "pos"}`}>{formatGBP(acct.pnl)}</span></div>
              </div>

              <ul className="inv-holdings">
                {acct.holdings.map((h) => (
                  <li key={h.symbol} className="inv-holding">
                    <span className="inv-h-main">
                      <span className="inv-h-name" title={h.name}>{h.name || h.symbol}</span>
                      <span className="inv-h-sub muted">{fmtQty(h.quantity)} {h.symbol}</span>
                    </span>
                    <span className="inv-h-fig">
                      <span className="inv-h-val num">{formatGBP(h.value)}</span>
                      {h.pnl != null && <span className={`inv-h-pnl num ${h.pnl < 0 ? "neg" : "pos"}`}>{h.pnl < 0 ? "" : "+"}{formatGBP(h.pnl)}</span>}
                    </span>
                  </li>
                ))}
                {acct.holdings.length === 0 && <li className="empty">No holdings.</li>}
              </ul>

              <div className="inv-panel-actions">
                <button type="button" className="btn-sm" disabled={busy != null} onClick={syncNow}>{busy === "sync" ? "Syncing…" : "Sync now"}</button>
                <button type="button" className="btn-sm danger" disabled={busy != null} onClick={disconnect}>{busy === "disconnect" ? "Disconnecting…" : "Disconnect"}</button>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

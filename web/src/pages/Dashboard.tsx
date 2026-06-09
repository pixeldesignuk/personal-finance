import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.ts";
import type { DashboardDTO, BankDTO, AuditEvent } from "../../../shared/types.ts";
import { formatGBP, formatMoney } from "../format.ts";
import { AccountSelector } from "../components/AccountSelector.tsx";
import { AuditSheet } from "../components/AuditSheet.tsx";
import { CategoryPie } from "../components/charts/CategoryPie.tsx";
import { MonthlyBar } from "../components/charts/MonthlyBar.tsx";
import { TopMerchants } from "../components/charts/TopMerchants.tsx";

export default function Dashboard() {
  const [params] = useSearchParams();
  const accountId = params.get("account") ?? undefined;
  const [data, setData] = useState<DashboardDTO | null>(null);
  const [banks, setBanks] = useState<BankDTO[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const qc = useQueryClient();
  const { data: summary } = useQuery({ queryKey: ["summary"], queryFn: () => api.summary() });

  const load = () => {
    api.dashboard(accountId).then(setData).catch((e) => setMsg(e.message));
    api.accounts().then(setBanks).catch(() => setBanks([]));
    qc.invalidateQueries({ queryKey: ["summary"] });
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [accountId]);

  const [syncOpen, setSyncOpen] = useState(false);
  const syncRun = useCallback((onEvent: (e: AuditEvent) => void) => api.syncStream(onEvent), []);

  const [hideSmall, setHideSmall] = useState(() => localStorage.getItem("dash.hideSmall") === "1");
  const toggleHideSmall = () => setHideSmall((v) => { localStorage.setItem("dash.hideSmall", v ? "0" : "1"); return !v; });

  if (!data) return <p>{msg ?? "Loading..."}</p>;
  return (
    <div>
      <div className="row-between">
        <h1>Dashboard</h1>
        <div className="toolbar">
          <AccountSelector />
          <button className="btn-primary" onClick={() => setSyncOpen(true)} disabled={syncOpen}>Sync now</button>
        </div>
      </div>
      <AuditSheet open={syncOpen} title="Sync" run={syncRun} onClose={() => setSyncOpen(false)} onDone={load} />
      {msg && <p className="muted">{msg}</p>}
      {summary && (
        <div className="grid">
          <div className="card stat">
            <span className="label">Net worth</span>
            <span className="value">{formatGBP(summary.netWorth)}</span>
            <span className="delta muted">
              {formatGBP(summary.available)} available
              {summary.included.assets && summary.assets > 0 && ` · ${formatGBP(summary.assets)} assets`}
              {summary.included.debts && summary.debts > 0 && ` · ${formatGBP(summary.debts)} debt`}
            </span>
          </div>
          <div className="card stat"><span className="label">Income · {summary.month}</span><span className="value pos">{formatGBP(summary.income)}</span></div>
          <div className="card stat"><span className="label">Expenses</span><span className="value neg">{formatGBP(summary.expenses)}</span></div>
          <div className="card stat">
            <span className="label">Investments</span>
            <span className="value">{formatGBP(summary.investments)}</span>
            <span className="delta muted">{summary.savingsRate}% savings rate</span>
          </div>
        </div>
      )}
      <div className="card">
        <div className="row-between" style={{ marginBottom: 6 }}>
          <h3 style={{ margin: 0 }}>Balances by account</h3>
          <label className="setting-row" style={{ padding: 0, cursor: "pointer" }}>
            <span className="muted" style={{ fontSize: 12 }}>Hide small (&lt;£100)</span>
            <span className="switch"><input type="checkbox" checked={hideSmall} onChange={toggleHideSmall} /><span className="slider" /></span>
          </label>
        </div>
        {banks.length === 0 && <div className="muted">No accounts yet.</div>}
        {banks.map((bank) =>
          bank.accounts
            .filter((a) => (!accountId || a.id === accountId) && (!hideSmall || Math.abs(a.currentBalance) >= 100))
            .map((a) => (
              <div key={a.id} className="lrow">
                <span>{bank.institutionName} <span className="muted">— {a.displayName}</span></span>
                <span className="num">{a.currency ?? "GBP"} {formatMoney(a.currentBalance)}</span>
              </div>
            )),
        )}
      </div>
      <div className="grid">
        <div className="card"><h3>By category</h3><CategoryPie data={data.byCategory} /></div>
        <div className="card"><h3>Monthly</h3><MonthlyBar data={data.monthly} /></div>
      </div>
      <div className="card"><h3>Top merchants</h3><TopMerchants data={data.topMerchants} /></div>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.ts";
import type { DashboardDTO, BankDTO, AuditEvent } from "../../../shared/types.ts";
import type { SummaryDTO } from "../../../shared/types.ts";
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
  const [summary, setSummary] = useState<SummaryDTO | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    api.dashboard(accountId).then(setData).catch((e) => setMsg(e.message));
    api.accounts().then(setBanks).catch(() => setBanks([]));
    api.summary().then(setSummary).catch(() => setSummary(null));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [accountId]);

  const [syncOpen, setSyncOpen] = useState(false);
  const syncRun = useCallback((onEvent: (e: AuditEvent) => void) => api.syncStream(onEvent), []);

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
          <div className="card stat"><span className="label">Net worth</span><span className="value">{formatGBP(summary.netWorth)}</span></div>
          <div className="card stat"><span className="label">Income · {summary.month}</span><span className="value pos">{formatGBP(summary.income)}</span></div>
          <div className="card stat"><span className="label">Expenses</span><span className="value neg">{formatGBP(summary.expenses)}</span></div>
          <div className="card stat"><span className="label">Net · savings rate</span><span className="value">{formatGBP(summary.net)} <span className="muted" style={{ fontSize: 15 }}>· {summary.savingsRate}%</span></span></div>
        </div>
      )}
      <div className="card">
        <h3>Balances by account</h3>
        {banks.length === 0 && <div className="muted">No accounts yet.</div>}
        {banks.map((bank) =>
          bank.accounts
            .filter((a) => !accountId || a.id === accountId)
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

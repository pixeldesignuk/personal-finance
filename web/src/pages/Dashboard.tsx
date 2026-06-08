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

  // Feature flag: include assets & debts in net worth (persisted).
  const [inclAD, setInclAD] = useState(() => localStorage.getItem("nw.inclAD") !== "0");
  const toggleAD = () => setInclAD((v) => { localStorage.setItem("nw.inclAD", v ? "0" : "1"); return !v; });

  if (!data) return <p>{msg ?? "Loading..."}</p>;
  const netWorth = summary ? (inclAD ? summary.netWorth : summary.netWorth - summary.assets + summary.debts) : 0;
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
            <span className="label">Net worth {!inclAD && <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>· excl. assets/debts</span>}</span>
            <span className="value">{formatGBP(netWorth)}</span>
            <span className="delta muted">
              {formatGBP(summary.available)} available
              {inclAD && summary.assets > 0 && ` · ${formatGBP(summary.assets)} assets`}
              {inclAD && summary.debts > 0 && ` · ${formatGBP(summary.debts)} debt`}
              <label style={{ marginLeft: 8, cursor: "pointer" }} title="Include assets & debts in net worth">
                <input type="checkbox" checked={inclAD} onChange={toggleAD} style={{ width: "auto", marginRight: 4, verticalAlign: "middle" }} />
                incl. A&D
              </label>
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

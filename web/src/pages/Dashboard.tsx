import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.ts";
import type { DashboardDTO, BankDTO, AuditEvent } from "../../../shared/types.ts";
import { formatGBP, formatMoney } from "../format.ts";
import { AccountSelector } from "../components/AccountSelector.tsx";
import { AuditSheet } from "../components/AuditSheet.tsx";
import { BrandLogo } from "../components/BrandLogo.tsx";
import { CategoryPie } from "../components/charts/CategoryPie.tsx";
import { MonthlyBar } from "../components/charts/MonthlyBar.tsx";
import { TopMerchants } from "../components/charts/TopMerchants.tsx";
import { PageHeader, Stat, Toggle } from "../components/ui";

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
  // Per-account balance delta captured from the live sync stream, so we can flash
  // the rows that actually moved once the dashboard reloads.
  const [changes, setChanges] = useState<Record<string, number>>({});
  const [syncNonce, setSyncNonce] = useState(0);
  const syncRun = useCallback((onEvent: (e: AuditEvent) => void) => {
    setChanges({});
    setSyncNonce((n) => n + 1);
    return api.syncStream((e) => {
      if (e.kind === "balance-change" && Math.abs(e.after - e.before) >= 0.005) {
        setChanges((c) => ({ ...c, [e.accountId]: e.after - e.before }));
      }
      onEvent(e);
    });
  }, []);

  const [hideSmall, setHideSmall] = useState(() => localStorage.getItem("dash.hideSmall") === "1");
  const toggleHideSmall = (v: boolean) => { localStorage.setItem("dash.hideSmall", v ? "1" : "0"); setHideSmall(v); };

  if (!data) return <p className="muted">{msg ?? "Loading…"}</p>;
  return (
    <div>
      <PageHeader
        title="Dashboard"
        actions={<>
          <AccountSelector />
          <button className="btn-primary" onClick={() => setSyncOpen(true)} disabled={syncOpen}>Sync now</button>
        </>}
      />
      <AuditSheet open={syncOpen} title="Sync" run={syncRun} onClose={() => setSyncOpen(false)} onDone={load} />
      {msg && <p className="muted">{msg}</p>}
      {summary && (
        <div className="grid">
          <Stat
            label="Net worth"
            value={formatGBP(summary.netWorth)}
            delta={<>
              {formatGBP(summary.available)} available
              {summary.included.assets && summary.assets > 0 ? ` · ${formatGBP(summary.assets)} assets` : ""}
              {summary.included.debts && summary.debts > 0 ? ` · ${formatGBP(summary.debts)} debt` : ""}
            </>}
          />
          <Stat label={`Income · ${summary.month}`} value={formatGBP(summary.income)} valueTone="pos" />
          <Stat label="Expenses" value={formatGBP(summary.expenses)} valueTone="neg" />
          <Stat label="Investments" value={formatGBP(summary.investments)} delta={`${summary.savingsRate}% savings rate`} />
        </div>
      )}
      <div className="card">
        <div className="card-head">
          <h3>Balances by account</h3>
          <Toggle checked={hideSmall} onChange={toggleHideSmall} label={<>Hide small (&lt;£100)</>} />
        </div>
        {banks.length === 0 && <div className="empty">No accounts yet.</div>}
        {banks.map((bank) =>
          bank.accounts
            .filter((a) => {
              if (accountId && a.id !== accountId) return false;
              if (hideSmall && Math.abs(a.currentBalance) < 100) return false;
              if (a.source === "INVESTMENT" && summary && !summary.included.investments) return false;
              if (a.source === "ASSET" && summary && !summary.included.assets) return false;
              if (a.source === "LIABILITY" && summary && !summary.included.debts) return false;
              return true;
            })
            .map((a) => {
              const delta = changes[a.id];
              return (
                <div key={`${a.id}-${syncNonce}-${delta ?? "x"}`} className={`lrow${delta != null ? " flash-update" : ""}`}>
                  <span className="lrow-acct">
                    <BrandLogo name={bank.institutionName} src={bank.institutionLogo} size={30} />
                    <span>{bank.institutionName} <span className="muted">— {a.displayName}</span></span>
                  </span>
                  <span className="num">
                    {delta != null && <span className={`delta-badge ${delta > 0 ? "pos" : "neg"}`}>{delta > 0 ? "+" : "−"}{formatMoney(Math.abs(delta))}</span>}
                    {a.currency ?? "GBP"} {formatMoney(a.currentBalance)}
                  </span>
                </div>
              );
            }),
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

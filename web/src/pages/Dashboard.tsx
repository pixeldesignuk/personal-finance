import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.ts";
import type { DashboardDTO, BankDTO } from "../../../shared/types.ts";
import type { SummaryDTO } from "../../../shared/types.ts";
import { AccountSelector } from "../components/AccountSelector.tsx";
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

  const sync = async () => {
    setMsg("Syncing...");
    try {
      const r = await api.sync();
      setMsg(r.map((x) => `${x.accountId.slice(0, 6)}: ${x.skipped ? x.message : `${x.added} txns`}`).join(" · "));
      load();
    } catch (e) { setMsg((e as Error).message); }
  };

  if (!data) return <p>{msg ?? "Loading..."}</p>;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Dashboard</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <AccountSelector />
          <button onClick={sync}>Sync now</button>
        </div>
      </div>
      {msg && <p>{msg}</p>}
      {summary && (
        <div className="grid" style={{ marginBottom: 16 }}>
          <div className="card"><div style={{ fontSize: 12, color: "#6b7280" }}>Net worth</div><div style={{ fontSize: 22 }}>£{summary.netWorth.toFixed(2)}</div></div>
          <div className="card"><div style={{ fontSize: 12, color: "#6b7280" }}>Income ({summary.month})</div><div style={{ fontSize: 22, color: "#16a34a" }}>£{summary.income.toFixed(2)}</div></div>
          <div className="card"><div style={{ fontSize: 12, color: "#6b7280" }}>Expenses</div><div style={{ fontSize: 22, color: "#dc2626" }}>£{summary.expenses.toFixed(2)}</div></div>
          <div className="card"><div style={{ fontSize: 12, color: "#6b7280" }}>Net · savings rate</div><div style={{ fontSize: 22 }}>£{summary.net.toFixed(2)} · {summary.savingsRate}%</div></div>
        </div>
      )}
      <div className="card">
        <h3>Balances by account</h3>
        {banks.length === 0 && <div>No accounts yet.</div>}
        {banks.map((bank) =>
          bank.accounts
            .filter((a) => !accountId || a.id === accountId)
            .map((a) => (
              <div key={a.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                <span>{bank.institutionName} — {a.displayName}</span>
                <span>{a.balances.map((b) => `${b.currency} ${b.amount}`).join(" / ") || "—"}</span>
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

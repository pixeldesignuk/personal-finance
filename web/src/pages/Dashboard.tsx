import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { DashboardDTO } from "../../../shared/types.ts";
import { CategoryPie } from "../components/charts/CategoryPie.tsx";
import { MonthlyBar } from "../components/charts/MonthlyBar.tsx";
import { TopMerchants } from "../components/charts/TopMerchants.tsx";

export default function Dashboard() {
  const [data, setData] = useState<DashboardDTO | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api.dashboard().then(setData).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);

  const sync = async () => {
    setMsg("Syncing...");
    try {
      const r = await api.sync();
      setMsg(r.map((x) => `${x.accountId.slice(0, 6)}: ${x.skipped ? x.message : `${x.added} txns`}`).join(" · "));
      await load();
    } catch (e) { setMsg((e as Error).message); }
  };

  if (!data) return <p>{msg ?? "Loading..."}</p>;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Dashboard</h1>
        <button onClick={sync}>Sync now</button>
      </div>
      {msg && <p>{msg}</p>}
      <div className="card">
        <h3>Balances</h3>
        {data.balances.map((b) => (
          <div key={b.accountId + b.type}>{b.type}: {b.currency} {b.amount}</div>
        ))}
      </div>
      <div className="grid">
        <div className="card"><h3>By category</h3><CategoryPie data={data.byCategory} /></div>
        <div className="card"><h3>Monthly</h3><MonthlyBar data={data.monthly} /></div>
      </div>
      <div className="card"><h3>Top merchants</h3><TopMerchants data={data.topMerchants} /></div>
    </div>
  );
}

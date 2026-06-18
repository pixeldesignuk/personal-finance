import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Send } from "lucide-react";
import { api } from "../api.ts";
import { BrandLogo } from "./BrandLogo.tsx";
import { formatGBP } from "../format.ts";
import { categoryClass } from "../categoryMeta.ts";

const shortDate = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";

// The latest few transactions, logo-led, each linking to the filtered
// Transactions view. Mirrors Origin/Monarch "latest transactions" cards.
// `cards` switches between the compact list rows and the Transactions-page
// card/grid style (chosen per-card in dashboard Customize mode).
export function RecentActivity({ accountId, cards }: { accountId?: string; cards?: boolean }) {
  const { data } = useQuery({ queryKey: ["recentTxns", accountId ?? "all"], queryFn: () => api.transactions("", accountId) });
  // accountId → owning bank, so each row can badge its account's bank logo.
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: () => api.accounts(), staleTime: 5 * 60_000 });
  const bankByAccount = useMemo(() => {
    const m: Record<string, { name: string; logo: string | null }> = {};
    for (const b of accountsQuery.data ?? []) for (const a of b.accounts) m[a.id] = { name: b.institutionName, logo: b.institutionLogo };
    return m;
  }, [accountsQuery.data]);
  // Recent activity = money that has actually moved. Drop not-yet-settled entries
  // (pending or future-dated) — they belong in Upcoming, not "recent".
  const today = new Date().toLocaleDateString("en-CA");
  const settled = (data ?? []).filter((t) => t.status !== "pending" && (t.bookingDate == null || t.bookingDate <= today));
  const rows = settled.slice(0, cards ? 9 : 8);
  const head = (
    <div className="flat-head">
      <div className="flat-head-titles">
        <h3>Recent activity</h3>
        <span className="flat-head-sub muted">Latest transactions</span>
      </div>
      <Link to="/transactions" className="amount-link">Transactions →</Link>
    </div>
  );

  if (rows.length === 0) {
    return <div className="card">{head}<p className="empty">No transactions yet.</p></div>;
  }

  if (cards) {
    return (
      <div className="card">
        {head}
        <div className="txnv2-grid txnv2-grid-auto">
          {rows.map((t) => {
            const amt = Number(t.amount);
            const income = amt > 0;
            const cls = income ? null : categoryClass(t.category);
            const name = t.name?.trim() || "—";
            return (
              <Link
                key={t.id}
                to={`/transactions?search=${encodeURIComponent(t.name ?? "")}`}
                className={`txnv2-card${income ? " is-income" : cls ? ` cls-${cls}` : ""}`}
              >
                <div className="txnv2-card-top">
                  <span className="txnv2-avatar"><BrandLogo name={name} src={t.logoUrl} size={34} /></span>
                  <span className={`num txnv2-amt${income ? " pos" : ""}`}>{income ? "+" : ""}{formatGBP(amt)}</span>
                </div>
                <div className="txnv2-card-bottom txnv2-card-bottom-row">
                  <span className="txnv2-name">{name}</span>
                  <span className="txnv2-sub muted">{shortDate(t.bookingDate)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  // Banking-app transaction list — flat (no card chrome), matches the
  // Transactions page list view.
  return (
    <div className="flat-list">
      {head}
      <div className="txnv2-list">
        {rows.map((t) => {
          const amt = Number(t.amount);
          const income = amt > 0;
          const name = t.name?.trim() || "—";
          const tg = t.origin === "telegram" || t.origin === "receipt";
          const bank = bankByAccount[t.accountId];
          return (
            <Link key={t.id} to={`/transactions?search=${encodeURIComponent(t.name ?? "")}`} className="txnv2-lrow">
              <span className="txnv2-lrow-av">
                <BrandLogo name={name} src={t.logoUrl} size={44} />
                <span className="txnv2-lrow-badge">
                  {tg
                    ? <span className="tg-avatar" title="Added via Telegram"><Send size={11} strokeWidth={2.4} /></span>
                    : <BrandLogo name={bank?.name ?? t.accountName} src={bank?.logo} size={20} />}
                </span>
              </span>
              <span className="txnv2-lrow-main">
                <span className="txnv2-lrow-name">{name}</span>
                <span className="txnv2-lrow-sub muted">{shortDate(t.bookingDate)}</span>
              </span>
              <span className={`num txnv2-lrow-amt ${income ? "pos" : "neg"}`}>{income ? "+" : "−"}{formatGBP(Math.abs(amt))}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

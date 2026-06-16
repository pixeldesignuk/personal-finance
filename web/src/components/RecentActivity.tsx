import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api.ts";
import { BrandLogo } from "./BrandLogo.tsx";
import { formatMoney, formatGBP } from "../format.ts";
import { categoryClass } from "../categoryMeta.ts";

const shortDate = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";

// The latest few transactions, logo-led, each linking to the filtered
// Transactions view. Mirrors Origin/Monarch "latest transactions" cards.
// `cards` switches between the compact list rows and the Transactions-page
// card/grid style (chosen per-card in dashboard Customize mode).
export function RecentActivity({ accountId, cards }: { accountId?: string; cards?: boolean }) {
  const { data } = useQuery({ queryKey: ["recentTxns", accountId ?? "all"], queryFn: () => api.transactions("", accountId) });
  // Recent activity = money that has actually moved. Drop not-yet-settled entries
  // (pending or future-dated) — they belong in Upcoming, not "recent".
  const today = new Date().toLocaleDateString("en-CA");
  const settled = (data ?? []).filter((t) => t.status !== "pending" && (t.bookingDate == null || t.bookingDate <= today));
  const rows = settled.slice(0, cards ? 9 : 8);
  const head = (
    <div className="card-head"><h3>Recent activity</h3><Link to="/transactions" className="amount-link">Transactions →</Link></div>
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

  return (
    <div className="card">
      {head}
      {rows.map((t) => {
        const amt = Number(t.amount);
        return (
          <Link key={t.id} to={`/transactions?search=${encodeURIComponent(t.name ?? "")}`} className="lrow lrow-link">
            <span className="lrow-acct">
              <BrandLogo name={t.name ?? t.accountName} size={30} />
              <span>{t.name ?? "—"} <span className="muted">— {shortDate(t.bookingDate)}</span></span>
            </span>
            <span className={`num ${amt < 0 ? "neg" : "pos"}`}>{amt < 0 ? "−" : "+"}{formatMoney(Math.abs(amt))}</span>
          </Link>
        );
      })}
    </div>
  );
}

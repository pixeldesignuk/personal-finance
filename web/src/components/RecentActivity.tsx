import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api.ts";
import { BrandLogo } from "./BrandLogo.tsx";
import { formatMoney } from "../format.ts";

const shortDate = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";

// The latest few transactions, logo-led, each linking to the filtered
// Transactions view. Mirrors Origin/Monarch "latest transactions" cards.
export function RecentActivity({ accountId }: { accountId?: string }) {
  const { data } = useQuery({ queryKey: ["recentTxns", accountId ?? "all"], queryFn: () => api.transactions("", accountId) });
  const rows = (data ?? []).slice(0, 8);
  return (
    <div className="card">
      <div className="card-head"><h3>Recent activity</h3><Link to="/transactions" className="amount-link">Transactions →</Link></div>
      {rows.length === 0
        ? <p className="empty">No transactions yet.</p>
        : rows.map((t) => {
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

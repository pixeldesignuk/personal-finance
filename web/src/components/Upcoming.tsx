import { Link } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { UpcomingDTO } from "../../../shared/types.ts";
import { formatGBP } from "../format.ts";
import { BrandLogo } from "./BrandLogo.tsx";

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const monthEndISO = () => new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10);
const thisMonthName = () => new Date().toLocaleDateString("en-GB", { month: "long" });

// The upcoming bills (out) + income (in) timeline from detected recurring
// schedules. `monthOnly` restricts it to the remainder of the current month
// (used on the dashboard so it matches safe-to-spend); otherwise it's the full
// window the API returned. `bare` drops the card chrome (flat list).
export function Upcoming({ data, limit = 7, monthOnly = false, bare = false }: { data: UpcomingDTO; limit?: number; monthOnly?: boolean; bare?: boolean }) {
  const monthEnd = monthEndISO();
  const scoped = monthOnly ? data.items.filter((i) => i.date <= monthEnd) : data.items;
  const items = scoped.slice(0, limit);
  return (
    <div className={bare ? "flat-list" : "card"}>
      <div className="flat-head">
        <div className="flat-head-titles">
          <h3>Upcoming bills &amp; income</h3>
          <span className="flat-head-sub muted">{monthOnly ? `Rest of ${thisMonthName()}` : `Next ${data.windowDays} days`}</span>
        </div>
        <Link to="/recurring" className="amount-link">Manage →</Link>
      </div>
      {items.length === 0 ? (
        <p className="empty">Nothing scheduled{monthOnly ? " for the rest of the month" : ""} — add or confirm recurring payments under Manage.</p>
      ) : (
        <div className="txnv2-list">
          {items.map((it, i) => {
            const out = it.direction === "out";
            return (
              <Link to="/recurring" className="txnv2-lrow" key={`${it.token}-${it.date}-${i}`}>
                <span className="txnv2-lrow-av">
                  <BrandLogo name={it.name} size={44} />
                  <span className="txnv2-lrow-badge">
                    <span className={`up-dir ${out ? "out" : "in"}`}>{out ? <ArrowUpRight size={11} strokeWidth={2.6} /> : <ArrowDownLeft size={11} strokeWidth={2.6} />}</span>
                  </span>
                </span>
                <span className="txnv2-lrow-main">
                  <span className="txnv2-lrow-name">{it.name}{it.prevAmount != null && <span className="upcoming-up" title={`Increased from ${formatGBP(it.prevAmount)}`}>↑</span>}{it.status === "auto" && <span className="upcoming-auto" title="Auto-detected — confirm under Manage">?</span>}</span>
                  <span className="txnv2-lrow-sub muted">{dayLabel(it.date)}</span>
                </span>
                <span className={`num txnv2-lrow-amt ${out ? "neg" : "pos"}`}>{out ? "−" : "+"}{formatGBP(it.amount).replace("-", "")}</span>
              </Link>
            );
          })}
          {scoped.length > limit && <Link to="/recurring" className="muted upcoming-more">+{scoped.length - limit} more →</Link>}
        </div>
      )}
    </div>
  );
}

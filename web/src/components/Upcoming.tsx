import { Link } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { UpcomingDTO } from "../../../shared/types.ts";
import { formatGBP } from "../format.ts";

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const monthEndISO = () => new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10);
const thisMonthName = () => new Date().toLocaleDateString("en-GB", { month: "long" });

// The upcoming bills (out) + income (in) timeline from detected recurring
// schedules. `monthOnly` restricts it to the remainder of the current month
// (used on the dashboard so it matches safe-to-spend); otherwise it's the full
// window the API returned.
export function Upcoming({ data, limit = 7, monthOnly = false }: { data: UpcomingDTO; limit?: number; monthOnly?: boolean }) {
  const monthEnd = monthEndISO();
  const scoped = monthOnly ? data.items.filter((i) => i.date <= monthEnd) : data.items;
  const items = scoped.slice(0, limit);
  const billsTotal = monthOnly ? data.billsDueThisMonth : data.billsNext30;
  const incomeTotal = monthOnly ? data.incomeDueThisMonth : data.incomeNext30;
  return (
    <div className="card">
      <div className="card-head">
        <h3>Upcoming · {monthOnly ? `rest of ${thisMonthName()}` : `next ${data.windowDays} days`}</h3>
        <Link to="/recurring" className="amount-link">Manage →</Link>
      </div>
      <div className="upcoming-totals">
        <span><span className="num neg">{formatGBP(billsTotal)}</span> <span className="muted">going out</span></span>
        {incomeTotal > 0 && <span><span className="num pos">{formatGBP(incomeTotal)}</span> <span className="muted">coming in</span></span>}
      </div>
      {items.length === 0 ? (
        <p className="empty">Nothing scheduled{monthOnly ? " for the rest of the month" : ""} — add or confirm recurring payments under Manage.</p>
      ) : (
        <div className="upcoming-list">
          {items.map((it, i) => {
            const out = it.direction === "out";
            return (
              <div className="upcoming-row" key={`${it.token}-${it.date}-${i}`}>
                <span className={`upcoming-ico ${out ? "out" : "in"}`}>{out ? <ArrowUpRight size={14} strokeWidth={2.2} /> : <ArrowDownLeft size={14} strokeWidth={2.2} />}</span>
                <span className="upcoming-date num">{dayLabel(it.date)}</span>
                <span className="upcoming-name td-clip">{it.name}{it.status === "auto" && <span className="upcoming-auto" title="Auto-detected — confirm under Manage">?</span>}</span>
                <span className={`num upcoming-amt ${out ? "neg" : "pos"}`}>{out ? "−" : "+"}{formatGBP(it.amount).replace("-", "")}</span>
              </div>
            );
          })}
          {scoped.length > limit && <Link to="/recurring" className="muted upcoming-more">+{scoped.length - limit} more →</Link>}
        </div>
      )}
    </div>
  );
}

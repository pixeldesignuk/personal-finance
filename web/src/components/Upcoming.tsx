import { Link } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { UpcomingDTO } from "../../../shared/types.ts";
import { formatGBP } from "../format.ts";

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// The next-N-days timeline of expected bills (out) and income (in), from
// detected recurring schedules. Presentational — pass the /upcoming payload.
export function Upcoming({ data, limit = 7 }: { data: UpcomingDTO; limit?: number }) {
  const items = data.items.slice(0, limit);
  return (
    <div className="card">
      <div className="card-head">
        <h3>Upcoming · next {data.windowDays} days</h3>
        <Link to="/recurring" className="amount-link">Manage →</Link>
      </div>
      <div className="upcoming-totals">
        <span><span className="num neg">{formatGBP(data.billsNext30)}</span> <span className="muted">going out</span></span>
        {data.incomeNext30 > 0 && <span><span className="num pos">{formatGBP(data.incomeNext30)}</span> <span className="muted">coming in</span></span>}
      </div>
      {items.length === 0 ? (
        <p className="empty">Nothing scheduled — confirm recurring payments under Manage.</p>
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
          {data.items.length > limit && <Link to="/recurring" className="muted upcoming-more">+{data.items.length - limit} more →</Link>}
        </div>
      )}
    </div>
  );
}

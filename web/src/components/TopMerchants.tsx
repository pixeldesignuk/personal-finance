import { Link } from "react-router-dom";
import { BrandLogo } from "./BrandLogo.tsx";
import { formatGBP } from "../format.ts";
import type { MerchantTotal } from "../../../shared/types.ts";

// Biggest merchants this month, logo-led — each row links to that merchant in
// the Transactions view. Fed by DashboardDTO.topMerchants (friendly names).
export function TopMerchants({ items, month }: { items: MerchantTotal[]; month: string }) {
  const rows = items.slice(0, 8);
  return (
    <div className="card">
      <div className="card-head"><h3>Top merchants</h3><Link to={`/reports?month=${month}`} className="amount-link">Reports →</Link></div>
      {rows.length === 0
        ? <p className="empty">No spending recorded.</p>
        : rows.map((m) => (
            <Link key={m.merchant} to={`/transactions?search=${encodeURIComponent(m.merchant)}`} className="lrow lrow-link">
              <span className="lrow-acct">
                <BrandLogo name={m.merchant} size={30} />
                <span>{m.merchant} <span className="muted">— {m.count}×</span></span>
              </span>
              <span className="num">{formatGBP(m.total)}</span>
            </Link>
          ))}
    </div>
  );
}

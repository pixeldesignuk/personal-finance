import { useEffect, useState } from "react";
import type { MonthlyTotal } from "../../../../shared/types.ts";
import { formatGBP } from "../../format.ts";

const monthShort = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short" });
const monthLong = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long" });

// A clean, minimal monthly-spend bar chart (Wise "Spending" style): rounded
// pill bars, the selected month emphasised, with average-vs-selected callouts.
// Selection is LOCAL — clicking a bar just updates the figure below; it does not
// change the page month (which would refetch the whole dashboard).
export function SpendBars({ data, activeMonth }: { data: MonthlyTotal[]; activeMonth: string }) {
  const [selected, setSelected] = useState(activeMonth);
  // Follow the page month if it changes via the month picker.
  useEffect(() => { setSelected(activeMonth); }, [activeMonth]);

  const max = Math.max(1, ...data.map((d) => d.spent));
  const withSpend = data.filter((d) => d.spent > 0).length || 1;
  const avg = data.reduce((s, d) => s + d.spent, 0) / withSpend;
  const sel = data.find((d) => d.month === selected) ?? data[data.length - 1];

  return (
    <div className="spendbars">
      <div className="spendbars-plot">
        {data.map((d) => (
          <button
            key={d.month}
            type="button"
            className={`spendbars-col${d.month === sel?.month ? " is-active" : ""}`}
            onClick={() => setSelected(d.month)}
            title={`${monthLong(d.month)} · ${formatGBP(d.spent)}`}
          >
            <span className="spendbars-bar" style={{ height: `${Math.round((d.spent / max) * 100)}%` }} />
            <span className="spendbars-x">{monthShort(d.month)}</span>
          </button>
        ))}
      </div>
      <div className="spendbars-stats">
        <div>
          <span className="num spendbars-fig">{formatGBP(avg)}</span>
          <span className="muted">Average monthly spend</span>
        </div>
        <div>
          <span className="num spendbars-fig is-sel">{formatGBP(sel?.spent ?? 0)}</span>
          <span className="muted">Spent in {monthLong(sel?.month ?? activeMonth)}</span>
        </div>
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useQueryState } from "nuqs";
import { api } from "../api.ts";
import { formatGBP } from "../format.ts";
import { categoryMeta, REMAINDER_COLOR } from "../categoryMeta.ts";
import { BudgetFan, type FanSegment } from "../components/charts/BudgetFan.tsx";
import { ProgressRing } from "../components/ProgressRing.tsx";
import { BudgetSheet } from "../components/BudgetSheet.tsx";
import { Tag, RotateCcw } from "lucide-react";

const nowMonth = () => new Date().toLocaleDateString("en-CA").slice(0, 7);
const addMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1 + delta, 1).toLocaleDateString("en-CA").slice(0, 7);
};
const monthAbbr = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short" });
const monthLong = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

const TOP_FAN = 10;    // segments before lumping into "Other"

export default function BudgetsV2() {
  const [month, setMonth] = useQueryState("month", { defaultValue: nowMonth(), history: "replace" });
  const [expanded, setExpanded] = useState(false);
  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ["budget", month], queryFn: () => api.budget(month) });

  const months = useMemo(() => Array.from({ length: 7 }, (_, i) => addMonth(month, i - 5)), [month]);

  // All categories with spend (+ a synthetic "Uncategorised" for spend not mapped
  // to a budget category, so the fan total matches summary.spent).
  const spendRows = useMemo(() => {
    const r = (data?.rows ?? []).filter((x) => x.spent > 0).sort((a, b) => b.spent - a.spent);
    const mapped = r.reduce((s, x) => s + x.spent, 0);
    const unc = Math.round(((data?.summary.spent ?? 0) - mapped) * 100) / 100;
    if (unc > 0.5) r.push({ id: -1, key: "uncategorised", name: "Uncategorised", group: null, budgeted: 0, spent: unc, left: 0, percent: 0 });
    return r.sort((a, b) => b.spent - a.spent);
  }, [data]);
  // Budgeted categories you haven't spent in yet — hidden behind "Show more".
  const budgetOnly = useMemo(() => (data?.rows ?? []).filter((x) => x.spent === 0 && x.budgeted > 0).sort((a, b) => b.budgeted - a.budgeted), [data]);

  const segments = useMemo<FanSegment[]>(() => {
    const top = spendRows.slice(0, TOP_FAN).map((r) => {
      const { Icon, color } = categoryMeta(r.key, r.group);
      return { key: r.key, name: r.name, value: r.spent, color, Icon };
    });
    const restTotal = spendRows.slice(TOP_FAN).reduce((s, r) => s + r.spent, 0);
    if (restTotal > 0) top.push({ key: "__other", name: "Other", value: restTotal, color: REMAINDER_COLOR, Icon: Tag });
    return top;
  }, [spendRows]);

  const spent = data?.summary.spent ?? 0;
  const budgeted = data?.summary.budgeted ?? 0;
  const refunded = data?.summary.refunded ?? 0;
  const totalSpent = spendRows.reduce((s, r) => s + r.spent, 0) || 1;
  const shown = expanded ? [...spendRows, ...budgetOnly] : spendRows;

  return (
    <div className="bv2">
      <div className="bv2-head">
        <h1>Budget</h1>
        <Link to="/budgets" className="amount-link">Classic →</Link>
      </div>

      {/* Month strip (Wise-style dots) */}
      <div className="bv2-months">
        {months.map((m) => (
          <button key={m} type="button" className={`bv2-month${m === month ? " is-active" : ""}`} onClick={() => setMonth(m)}>
            {m === month && budgeted > 0
              ? <ProgressRing value={spent / budgeted} size={26} stroke={3} />
              : <span className="bv2-month-dot" />}
            <span className="bv2-month-label">{monthAbbr(m)}</span>
          </button>
        ))}
      </div>

      {/* Radial fan hero */}
      {segments.length > 0
        ? <BudgetFan segments={segments} spent={spent} budgeted={budgeted} onSelect={setSheetKey} />
        : <p className="empty bv2-empty">No spending recorded for {monthLong(month)}.</p>}

      {refunded > 0 && (
        <p className="bv2-refund"><RotateCcw size={13} strokeWidth={2.2} /> {formatGBP(refunded)} refunded this month</p>
      )}

      {/* Category list */}
      <div className="bv2-list-head">
        <span>Spending categories</span>
        <span>Spend / Budget</span>
      </div>
      {shown.map((r) => {
        const { Icon, color } = categoryMeta(r.key, r.group);
        const pct = r.budgeted > 0 ? Math.min(100, (r.spent / r.budgeted) * 100) : (r.spent > 0 ? 100 : 0);
        const over = r.budgeted > 0 && r.spent > r.budgeted;
        const inner = (
          <>
            <span className="bv2-badge" style={{ background: color }}><Icon size={19} strokeWidth={2.1} color="#0c0d0e" /></span>
            <div className="bv2-row-main">
              <div className="bv2-row-top">
                <span className="bv2-row-name">{r.name}</span>
                <span className="num bv2-row-amt">
                  {formatGBP(r.spent)} <span className="muted">/ {formatGBP(r.budgeted)}</span>
                </span>
              </div>
              <div className="bv2-track"><i style={{ width: `${pct}%`, background: over ? "var(--coral)" : color }} /></div>
              <span className="bv2-row-share muted">{Math.round((r.spent / totalSpent) * 100)}% of spend{over ? " · over budget" : ""}</span>
            </div>
          </>
        );
        // Real categories open the detail sheet; the synthetic "Uncategorised"
        // lump (no editable budget) links straight to its transactions.
        return r.key === "uncategorised"
          ? <Link key={r.key} to={`/transactions?month=${month}`} className="bv2-row">{inner}</Link>
          : <button key={r.key} type="button" className="bv2-row" onClick={() => setSheetKey(r.key)}>{inner}</button>;
      })}
      {budgetOnly.length > 0 && (
        <button type="button" className="bv2-more" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Show less" : `Show ${budgetOnly.length} budgeted (no spend yet)`}
        </button>
      )}

      {sheetKey && <BudgetSheet categoryKey={sheetKey} month={month} onClose={() => setSheetKey(null)} />}
    </div>
  );
}

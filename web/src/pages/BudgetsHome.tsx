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
import { Tag, AlertTriangle, ChevronDown } from "lucide-react";

const nowMonth = () => new Date().toLocaleDateString("en-CA").slice(0, 7);
const addMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1 + delta, 1).toLocaleDateString("en-CA").slice(0, 7);
};
const monthAbbr = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short" });
const monthLong = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

const TOP_FAN = 10;    // segments before lumping into "Other"

export default function BudgetsHome() {
  const [month, setMonth] = useQueryState("month", { defaultValue: nowMonth(), history: "replace" });
  const [sort, setSort] = useQueryState("sort", { defaultValue: "spend", history: "replace" });
  const [expanded, setExpanded] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ["budget", month], queryFn: () => api.budget(month) });

  // Upcoming bills per category → the shaded slice of each row's budget bar.
  // Only meaningful for the current month; bounded to occurrences within it.
  const isCurrentMonth = month === nowMonth();
  const monthEnd = useMemo(() => { const [y, m] = month.split("-").map(Number); return new Date(y, m, 0).toLocaleDateString("en-CA"); }, [month]);
  const { data: upcoming } = useQuery({ queryKey: ["upcoming", 30], queryFn: () => api.upcoming(30), enabled: isCurrentMonth });
  const upByCat = useMemo(() => {
    const m = new Map<string, number>();
    if (!isCurrentMonth) return m;
    for (const u of upcoming?.items ?? []) {
      if (u.direction !== "out" || !u.category || u.date > monthEnd) continue;
      m.set(u.category, (m.get(u.category) ?? 0) + u.amount);
    }
    return m;
  }, [upcoming, isCurrentMonth, monthEnd]);

  const months = useMemo(() => Array.from({ length: 7 }, (_, i) => addMonth(month, i - 5)), [month]);

  // All categories with spend (+ a synthetic "Uncategorised" for spend not mapped
  // to a budget category, so the fan total matches summary.spent).
  const isOver = (r: { budgeted: number; spent: number }) => r.budgeted > 0 && r.spent > r.budgeted;
  // List ordering. "spend" (default) keeps overspent at the top then biggest spend;
  // "az" is alphabetical; "left" is least-left-to-spend first (so overspent leads).
  type Row = { id: number; key: string; name: string; group: string | null; budgeted: number; spent: number; left: number; percent: number };
  const byOrder = (a: Row, b: Row) => {
    if (sort === "az") return a.name.localeCompare(b.name);
    if (sort === "left") return a.left - b.left;
    return (isOver(b) ? 1 : 0) - (isOver(a) ? 1 : 0) || (b.spent - a.spent) || (b.budgeted - a.budgeted);
  };

  // All categories with spend (+ a synthetic "Uncategorised" for spend not mapped
  // to a budget category, so the fan total matches summary.spent).
  const baseRows = useMemo(() => {
    const r = (data?.rows ?? []).filter((x) => x.spent > 0);
    const mapped = r.reduce((s, x) => s + x.spent, 0);
    const unc = Math.round(((data?.summary.spent ?? 0) - mapped) * 100) / 100;
    if (unc > 0.5) r.push({ id: -1, key: "uncategorised", name: "Uncategorised", group: null, budgeted: 0, spent: unc, left: 0, percent: 0 });
    return r;
  }, [data]);
  // The fan hero always shows the biggest spenders, independent of list ordering.
  const fanRows = useMemo(() => [...baseRows].sort((a, b) => b.spent - a.spent), [baseRows]);
  const spendRows = useMemo(() => [...baseRows].sort(byOrder), [baseRows, sort]);
  // Budgeted categories you haven't spent in yet — hidden behind "Show more".
  const budgetOnly = useMemo(() => (data?.rows ?? []).filter((x) => x.spent === 0 && x.budgeted > 0).sort(byOrder), [data, sort]);

  // Overspent categories drive the top-of-page alert (YNAB-style) and the per-row
  // red treatment. Largest overspend first so the banner can jump straight to it.
  const overRows = useMemo(
    () => (data?.rows ?? [])
      .filter(isOver)
      .map((r) => ({ key: r.key, name: r.name, over: r.spent - r.budgeted }))
      .sort((a, b) => b.over - a.over),
    [data],
  );
  const totalOver = useMemo(() => overRows.reduce((s, r) => s + r.over, 0), [overRows]);

  const segments = useMemo<FanSegment[]>(() => {
    const top = fanRows.slice(0, TOP_FAN).map((r) => {
      const { Icon, color } = categoryMeta(r.key, r.group);
      return { key: r.key, name: r.name, value: r.spent, color, Icon };
    });
    const restTotal = fanRows.slice(TOP_FAN).reduce((s, r) => s + r.spent, 0);
    if (restTotal > 0) top.push({ key: "__other", name: "Other", value: restTotal, color: REMAINDER_COLOR, Icon: Tag });
    return top;
  }, [fanRows]);

  const spent = data?.summary.spent ?? 0;
  const budgeted = data?.summary.budgeted ?? 0;
  const totalSpent = baseRows.reduce((s, r) => s + r.spent, 0) || 1;
  const shown = expanded ? [...spendRows, ...budgetOnly] : spendRows;

  return (
    <div className="bv2">
      {/* Overspent alert — clear and red, pinned above the month selector; tap to
          expand the full list of offenders, each opening its own sheet to fix. */}
      {overRows.length > 0 && (
        <div className={`bv2-alert-wrap${alertOpen ? " is-open" : ""}`}>
          <button type="button" className="bv2-alert" onClick={() => setAlertOpen((o) => !o)} aria-expanded={alertOpen}>
            <span className="bv2-alert-ico"><AlertTriangle size={18} strokeWidth={2.2} /></span>
            <span className="bv2-alert-txt">
              <strong>{overRows.length} categor{overRows.length === 1 ? "y" : "ies"} over budget</strong>
              <span className="bv2-alert-sub">{overRows.map((r) => r.name).slice(0, 3).join(", ")}{overRows.length > 3 ? "…" : ""} · tap to {alertOpen ? "hide" : "review"}</span>
            </span>
            <span className="num bv2-alert-amt">{formatGBP(totalOver)}<span className="bv2-alert-unit"> over</span></span>
            <ChevronDown className="bv2-alert-chev" size={18} strokeWidth={2.2} />
          </button>
          {alertOpen && (
            <div className="bv2-alert-list">
              {overRows.map((r) => (
                <button key={r.key} type="button" className="bv2-alert-item" onClick={() => setSheetKey(r.key)}>
                  <span className="bv2-alert-item-name">{r.name}</span>
                  <span className="num bv2-over">{formatGBP(r.over)} over</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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

      {/* Category list */}
      <div className="bv2-list-head">
        <span>Spending categories</span>
        <select className="bv2-sort" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort categories">
          <option value="spend">Most spent</option>
          <option value="az">A–Z</option>
          <option value="left">Left to spend</option>
        </select>
      </div>
      {shown.map((r) => {
        const { Icon, color } = categoryMeta(r.key, r.group);
        const pct = r.budgeted > 0 ? Math.min(100, (r.spent / r.budgeted) * 100) : (r.spent > 0 ? 100 : 0);
        const over = isOver(r);
        const upW = r.budgeted > 0 ? Math.max(0, Math.min(100 - pct, ((upByCat.get(r.key) ?? 0) / r.budgeted) * 100)) : 0;
        const inner = (
          <>
            <span className="bv2-badge" style={{ background: color }}><Icon size={19} strokeWidth={2.1} color="#0c0d0e" /></span>
            <div className="bv2-row-main">
              <div className="bv2-row-top">
                <span className="bv2-row-name">{r.name}</span>
                <span className="num bv2-row-amt">
                  {over
                    ? <><span className="bv2-over">{formatGBP(r.spent - r.budgeted)} over</span> <span className="muted">/ {formatGBP(r.budgeted)}</span></>
                    : <>{formatGBP(r.spent)} <span className="muted">/ {formatGBP(r.budgeted)}</span></>}
                </span>
              </div>
              <div className="bv2-track">
                <i style={{ width: `${pct}%`, background: over ? "var(--coral)" : color }} />
                {upW > 0 && <i className="up-shade" style={{ width: `${upW}%`, "--shade": color } as React.CSSProperties} />}
              </div>
              <span className="bv2-row-share muted">
                {over ? `Spent ${formatGBP(r.spent)} of ${formatGBP(r.budgeted)}` : `${Math.round((r.spent / totalSpent) * 100)}% of spend`}
              </span>
            </div>
          </>
        );
        // Real categories open the detail sheet; the synthetic "Uncategorised"
        // lump (no editable budget) links straight to its transactions.
        return r.key === "uncategorised"
          ? <Link key={r.key} to={`/transactions?month=${month}`} className="bv2-row">{inner}</Link>
          : <button key={r.key} type="button" className={`bv2-row${over ? " is-over" : ""}`} onClick={() => setSheetKey(r.key)}>{inner}</button>;
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

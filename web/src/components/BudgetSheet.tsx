import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { api } from "../api.ts";
import type { TransactionDTO } from "../../../shared/types.ts";
import { formatGBP } from "../format.ts";
import { categoryMeta } from "../categoryMeta.ts";
import { merchantLogo } from "../brand.ts";
import { BrandLogo } from "./BrandLogo.tsx";

const monthShort = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short" });
const monthLong = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long" });
const dayShort = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");
const txnName = (r: TransactionDTO) => r.name?.trim() || r.remittanceInfo?.trim() || "Unknown";

// Bottom sheet showing one budget category in depth: a recent-months spend bar
// chart, an editable monthly budget with average / left-this-month stats, and
// the month's transactions. Portalled to body so it overlays the whole page.
export function BudgetSheet({ categoryKey, month, onClose }: { categoryKey: string; month: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { Icon, color } = categoryMeta(categoryKey);

  const { data: hist } = useQuery({ queryKey: ["categoryHistory", categoryKey, month], queryFn: () => api.categoryHistory(categoryKey, month, 7) });
  const { data: txns } = useQuery({ queryKey: ["transactions", "", undefined, "", month, ""], queryFn: () => api.transactions("", undefined, undefined, month, undefined) });

  const monthTxns = useMemo(
    () => (txns ?? []).filter((t) => t.category === categoryKey && Number(t.amount) < 0).sort((a, b) => (b.bookingDate ?? "").localeCompare(a.bookingDate ?? "")),
    [txns, categoryKey],
  );

  const months = hist?.months ?? [];
  const spent = months.length ? months[months.length - 1].spent : 0;
  const average = months.length ? months.reduce((s, m) => s + m.spent, 0) / months.length : 0;
  const maxBar = Math.max(1, ...months.map((m) => m.spent));

  const [budgetStr, setBudgetStr] = useState("");
  useEffect(() => { if (hist) setBudgetStr(hist.monthlyAmount.toFixed(2)); }, [hist]);
  const budget = Number(budgetStr) || 0;
  const left = budget - spent;
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : spent > 0 ? 100 : 0;
  const over = budget > 0 && spent > budget;

  const saveBudget = useMutation({
    mutationFn: (amount: number) => api.patchCategory(hist!.categoryId, { monthlyAmount: amount }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["budget"] }); qc.invalidateQueries({ queryKey: ["categoryHistory", categoryKey] }); },
  });
  const commitBudget = () => {
    const v = Math.round((Number(budgetStr) || 0) * 100) / 100;
    setBudgetStr(v.toFixed(2));
    if (hist && v !== hist.monthlyAmount) saveBudget.mutate(v);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="sheet-backdrop bsheet-backdrop" onClick={onClose}>
      <div className="bsheet" onClick={(e) => e.stopPropagation()}>
        <div className="bsheet-grip" />
        <header className="bsheet-head">
          <span className="bsheet-badge" style={{ background: color }}><Icon size={20} strokeWidth={2.1} color="#0c0d0e" /></span>
          <h2>{hist?.name ?? ""}</h2>
          <button type="button" className="bsheet-x" onClick={onClose} aria-label="Close"><X size={18} strokeWidth={2.5} /></button>
        </header>

        <div className="bsheet-figure">
          <span className="num">{formatGBP(spent)}</span>
          <span className="bsheet-figure-sub">in {monthLong(month)}</span>
        </div>

        {/* Recent-months bar chart */}
        <div className="bsheet-bars">
          {months.map((m) => {
            const active = m.month === month;
            return (
              <div key={m.month} className={`bsheet-col${active ? " is-active" : ""}`}>
                <span className="bsheet-bar-track">
                  <span className="bsheet-bar" style={{ height: `${Math.round((m.spent / maxBar) * 100)}%`, background: active ? color : undefined }} />
                </span>
                <span className="bsheet-bar-x">{monthShort(m.month)}</span>
                <span className="bsheet-bar-val num">{m.spent > 0 ? formatGBP(m.spent) : "—"}</span>
              </div>
            );
          })}
        </div>

        {/* Stats + editable budget */}
        <div className="bsheet-stats">
          <div className="bsheet-stat">
            <span className="bsheet-stat-label">Average monthly</span>
            <span className="num bsheet-stat-val">{formatGBP(average)}</span>
          </div>
          <div className="bsheet-stat bsheet-stat-budget">
            <span className="bsheet-stat-label">Monthly budget</span>
            <span className="bsheet-budget-input">
              <span>£</span>
              <input
                inputMode="decimal" value={budgetStr}
                onChange={(e) => setBudgetStr(e.target.value)}
                onBlur={commitBudget}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              />
            </span>
          </div>
          <div className="bsheet-stat bsheet-stat-right">
            <span className="bsheet-stat-label">Left this month</span>
            <span className={`num bsheet-stat-val ${left < 0 ? "neg" : "pos"}`}>{formatGBP(left)}</span>
          </div>
          <div className="bsheet-progress-row">
            <span className="bsheet-dot" style={{ background: over ? "var(--coral)" : color }} />
            <span className="muted">{formatGBP(spent)} spent of {formatGBP(budget)} budget{over ? " · over" : ""}</span>
          </div>
          <div className="bsheet-progress-meta muted">{budget > 0 ? `${Math.round((spent / budget) * 100)}% of budget` : "No budget set"}</div>
          <div className="bsheet-track"><i style={{ width: `${pct}%`, background: over ? "var(--coral)" : color }} /></div>
        </div>

        {/* This month's transactions */}
        <div className="bsheet-txns">
          <h3>In {monthLong(month)}</h3>
          {monthTxns.length === 0 && <p className="muted bsheet-empty">No transactions this month.</p>}
          {monthTxns.map((t) => {
            const name = txnName(t);
            return (
              <div key={t.id} className="bsheet-txn">
                <BrandLogo name={name} src={merchantLogo(name, null)} size={28} />
                <div className="bsheet-txn-main">
                  <span className="bsheet-txn-name">{name}</span>
                  <span className="bsheet-txn-date muted">{dayShort(t.bookingDate)}</span>
                </div>
                <span className="num bsheet-txn-amt">{formatGBP(Math.abs(Number(t.amount)))}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

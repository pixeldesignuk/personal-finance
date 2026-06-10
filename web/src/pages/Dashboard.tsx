import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryState } from "nuqs";
import { ShieldCheck, AlertTriangle, PiggyBank, Landmark, ArrowDownLeft } from "lucide-react";
import { api } from "../api.ts";
import type { BankDTO, AuditEvent } from "../../../shared/types.ts";
import { formatGBP, formatMoney } from "../format.ts";
import { AccountSelector } from "../components/AccountSelector.tsx";
import { AuditSheet } from "../components/AuditSheet.tsx";
import { BrandLogo } from "../components/BrandLogo.tsx";
import { MonthlyBar } from "../components/charts/MonthlyBar.tsx";
import { BarList } from "../components/BarList.tsx";
import { Upcoming } from "../components/Upcoming.tsx";
import { PageHeader, Stat, Toggle } from "../components/ui";

const nowMonth = () => new Date().toLocaleDateString("en-CA").slice(0, 7);
const addMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1 + delta, 1).toLocaleDateString("en-CA").slice(0, 7);
};
const barClass = (pct: number) => (pct > 100 ? "over" : pct >= 80 ? "warn" : "ok");
function payoffLabel(months: number | null): string {
  if (!months || months <= 0) return "—";
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}
// Fraction of the current month elapsed (for the "spend pace" check).
function monthElapsedPct(): number {
  const now = new Date();
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.round((now.getDate() / days) * 100);
}

export default function Dashboard() {
  const [params] = useSearchParams();
  const accountId = params.get("account") ?? undefined;
  const [month, setMonth] = useQueryState("month", { defaultValue: nowMonth(), history: "replace" });
  const qc = useQueryClient();

  const { data: summary } = useQuery({ queryKey: ["summary"], queryFn: () => api.summary() });
  const dashQuery = useQuery({ queryKey: ["dashboard", accountId, month], queryFn: () => api.dashboard(accountId, month) });
  const { data: budget } = useQuery({ queryKey: ["budget", month], queryFn: () => api.budget(month) });
  const prevMonth = addMonth(month, -1);
  const { data: budgetPrev } = useQuery({ queryKey: ["budget", prevMonth], queryFn: () => api.budget(prevMonth) });
  const { data: pots } = useQuery({ queryKey: ["pots"], queryFn: () => api.pots() });
  const { data: debts } = useQuery({ queryKey: ["debts"], queryFn: () => api.debts() });
  const { data: upcoming } = useQuery({ queryKey: ["upcoming"], queryFn: () => api.upcoming(30) });
  const { data: catNames } = useQuery({ queryKey: ["categoryNames"], queryFn: () => api.categoryNames(), staleTime: 300_000 });

  // Per-account balances list (with bank logos + post-sync flash).
  const [banks, setBanks] = useState<BankDTO[]>([]);
  const loadBanks = useCallback(() => { api.accounts().then(setBanks).catch(() => setBanks([])); }, []);
  useEffect(() => { loadBanks(); }, [loadBanks]);

  const reload = () => {
    qc.invalidateQueries({ queryKey: ["summary"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["budget"] });
    qc.invalidateQueries({ queryKey: ["pots"] });
    qc.invalidateQueries({ queryKey: ["debts"] });
    qc.invalidateQueries({ queryKey: ["upcoming"] });
    loadBanks();
  };

  // Sync (streamed) + flash the rows whose balance actually moved.
  const [syncOpen, setSyncOpen] = useState(false);
  const [changes, setChanges] = useState<Record<string, number>>({});
  const [syncNonce, setSyncNonce] = useState(0);
  const syncRun = useCallback((onEvent: (e: AuditEvent) => void) => {
    setChanges({});
    setSyncNonce((n) => n + 1);
    return api.syncStream((e) => {
      if (e.kind === "balance-change" && Math.abs(e.after - e.before) >= 0.005) {
        setChanges((c) => ({ ...c, [e.accountId]: e.after - e.before }));
      }
      onEvent(e);
    });
  }, []);

  const [hideSmall, setHideSmall] = useState(() => localStorage.getItem("dash.hideSmall") === "1");
  const toggleHideSmall = (v: boolean) => { localStorage.setItem("dash.hideSmall", v ? "1" : "0"); setHideSmall(v); };

  const catName = useMemo(() => {
    const m = new Map((catNames ?? []).map((c) => [c.key, c.name] as const));
    return (key: string) => m.get(key) ?? key;
  }, [catNames]);

  // ── The reassurance maths ────────────────────────────────────────────────
  const inBank = summary?.available ?? 0;
  const billsDue = upcoming?.billsDueThisMonth ?? 0;
  const earmarked = pots?.allocated ?? 0;
  const safeToSpend = inBank - billsDue - earmarked;
  const billsDueCount = useMemo(() => {
    if (!upcoming) return 0;
    const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10);
    return upcoming.items.filter((i) => i.direction === "out" && i.date <= monthEnd).length;
  }, [upcoming]);
  const safe = safeToSpend >= 0;
  // Pay-date reassurance: income still expected this month + projected month-end balance.
  const incomeDue = upcoming?.incomeDueThisMonth ?? 0;
  const nextPay = upcoming?.items.find((i) => i.direction === "in") ?? null;
  const projectedEom = inBank - billsDue + incomeDue;
  const dayShort = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  const spent = budget?.summary.spent ?? 0;
  const budgeted = budget?.summary.budgeted ?? 0;
  const income = budget?.summary.income ?? 0;
  const net = income - spent;
  const budgetPct = budgeted > 0 ? Math.round((spent / budgeted) * 100) : (spent > 0 ? 100 : 0);
  const elapsed = monthElapsedPct();

  // Month-over-month reference for the stat cards.
  const prevSpent = budgetPrev?.summary.spent ?? 0;
  const prevIncome = budgetPrev?.summary.income ?? 0;
  const mom = (curr: number, prev: number, goodWhenUp: boolean): { node: string; tone: "muted" | "pos" | "neg" } => {
    if (prev <= 0) return { node: "vs last month", tone: "muted" };
    const d = curr - prev;
    if (Math.abs(d) < 0.005) return { node: "— vs last month", tone: "muted" };
    const up = d > 0;
    const pct = Math.round((Math.abs(d) / prev) * 100);
    return { node: `${up ? "↑" : "↓"} ${formatGBP(Math.abs(d))} (${pct}%) vs last month`, tone: up === goodWhenUp ? "pos" : "neg" };
  };
  const incomeMom = mom(income, prevIncome, true);
  const spentMom = mom(spent, prevSpent, false);
  const netMom = mom(net, prevIncome - prevSpent, true);

  // Budget groups (top spenders this month).
  const groups = useMemo(() => {
    const m = new Map<string, { spent: number; budgeted: number }>();
    for (const r of budget?.rows ?? []) {
      const g = r.group ?? "Other";
      const e = m.get(g) ?? { spent: 0, budgeted: 0 };
      e.spent += r.spent; e.budgeted += r.budgeted; m.set(g, e);
    }
    return [...m.entries()].filter(([, v]) => v.spent > 0 || v.budgeted > 0).sort((a, b) => b[1].spent - a[1].spent).slice(0, 5);
  }, [budget]);

  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const isThisMonth = month === nowMonth();

  // Debt + savings snapshots.
  const debtFreeMonths = useMemo(() => (debts?.debts ?? []).filter((d) => !d.excluded && d.balance > 0).reduce((m, d) => Math.max(m, d.projectedMonths ?? 0), 0), [debts]);
  const debtProgress = debts && (debts.totalPaid + debts.totalOwed) > 0 ? Math.round((debts.totalPaid / (debts.totalPaid + debts.totalOwed)) * 100) : 0;
  const nearestPot = useMemo(() => {
    const withTarget = (pots?.pots ?? []).filter((p) => p.target && p.target > 0 && p.balance < (p.target ?? 0));
    return withTarget.sort((a, b) => (b.balance / (b.target ?? 1)) - (a.balance / (a.target ?? 1)))[0] ?? null;
  }, [pots]);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        actions={<>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: "auto" }} aria-label="Month" />
          <AccountSelector />
          <button className="btn-primary" onClick={() => setSyncOpen(true)} disabled={syncOpen}>Sync now</button>
        </>}
      />
      <AuditSheet open={syncOpen} title="Sync" run={syncRun} onClose={() => setSyncOpen(false)} onDone={reload} />

      {/* ── Reassurance hero: safe to spend ─────────────────────────────── */}
      {summary && (
        <div className={`card hero ${safe ? "hero-safe" : "hero-over"}`}>
          <div className="hero-main">
            <span className="hero-eyebrow">
              <span className={`hero-chip ${safe ? "ok" : "over"}`}>{safe ? <ShieldCheck size={13} strokeWidth={2.2} /> : <AlertTriangle size={13} strokeWidth={2.2} />}{safe ? "On track" : "Over"}</span>
              Safe to spend now
            </span>
            <span className={`hero-figure num ${safe ? "" : "neg"}`}>{formatGBP(safeToSpend)}</span>
            <span className="hero-breakdown">
              {formatGBP(inBank)} in the bank
              {billsDue > 0 && <> − <span className="neg">{formatGBP(billsDue)}</span> bills still due</>}
              {earmarked > 0 && <> − {formatGBP(earmarked)} in pots</>}
            </span>
            {incomeDue > 0 && (
              <span className="hero-income">
                <ArrowDownLeft size={13} strokeWidth={2.2} />
                {formatGBP(incomeDue)} expected{nextPay ? ` ~${dayShort(nextPay.date)}` : ""} · <strong>{formatGBP(projectedEom)}</strong> projected by month-end
              </span>
            )}
          </div>
          <div className="hero-side">
            <div className="hero-bar-head">
              <span className="muted">{monthLabel} budget</span>
              <span className="num">{formatGBP(spent)} <span className="muted">/ {formatGBP(budgeted)}</span></span>
            </div>
            <div className="progress"><i className={barClass(budgetPct)} style={{ width: `${Math.min(budgetPct, 100)}%` }} /></div>
            <span className="hero-pace muted">
              {budgeted > 0 ? `${budgetPct}% of budget used · ${elapsed}% of month gone` : "No budget set yet"}
              {billsDueCount > 0 && ` · ${billsDueCount} bill${billsDueCount === 1 ? "" : "s"} left`}
            </span>
          </div>
        </div>
      )}

      {/* ── Headline figures (with month-over-month reference) ──────────── */}
      {summary && (
        <div className="grid">
          <Stat label="Income" value={formatGBP(income)} valueTone="pos" delta={incomeMom.node} deltaTone={incomeMom.tone} />
          <Stat label={`Spent · ${isThisMonth ? "this month" : monthLabel}`} value={formatGBP(spent)} valueTone="neg" delta={spentMom.node} deltaTone={spentMom.tone} />
          <Stat
            label="Upcoming · rest of month"
            value={formatGBP(billsDue)}
            valueTone="neg"
            delta={`${incomeDue > 0 ? `+${formatGBP(incomeDue)} in · ` : ""}${billsDueCount} bill${billsDueCount === 1 ? "" : "s"} left`}
          />
          <Stat label="Net this month" value={formatGBP(net)} valueTone={net < 0 ? "neg" : "pos"} delta={netMom.node} deltaTone={netMom.tone} />
        </div>
      )}

      {/* ── Goals: clear debt · build savings ───────────────────────────── */}
      <div className="grid">
        {debts && debts.totalOwed > 0 && (
          <Link to="/debts" className="card goal-card">
            <div className="goal-head"><span className="goal-ico debt"><Landmark size={16} strokeWidth={1.9} /></span><h3>Debt</h3><span className="num neg">{formatGBP(debts.totalOwed)}</span></div>
            <div className="progress"><i className="ok" style={{ width: `${Math.min(debtProgress, 100)}%` }} /></div>
            <span className="muted goal-sub">{formatGBP(debts.totalPaid)} repaid · {debtFreeMonths ? `debt-free ${payoffLabel(debtFreeMonths)}` : "log payments to project"}</span>
          </Link>
        )}
        {pots && (
          <Link to="/savings" className="card goal-card">
            <div className="goal-head"><span className="goal-ico save"><PiggyBank size={16} strokeWidth={1.9} /></span><h3>Savings</h3><span className="num">{formatGBP(pots.allocated)}</span></div>
            {nearestPot ? (
              <>
                <div className="progress"><i className="ok" style={{ width: `${Math.min(100, Math.round((nearestPot.balance / (nearestPot.target ?? 1)) * 100))}%` }} /></div>
                <span className="muted goal-sub">{nearestPot.name}: {formatGBP(nearestPot.balance)} of {formatGBP(nearestPot.target ?? 0)} · {formatGBP(Math.max(0, pots.available))} to assign</span>
              </>
            ) : (
              <span className="muted goal-sub">{formatGBP(Math.max(0, pots.available))} available to assign · set a pot goal</span>
            )}
          </Link>
        )}
      </div>

      {/* ── Upcoming bills + income ─────────────────────────────────────── */}
      {upcoming && <Upcoming data={upcoming} />}

      {/* ── Where the money went (this month) + budget by group ─────────── */}
      <div className="grid">
        <div className="card">
          <div className="card-head"><h3>Where it went · {isThisMonth ? "this month" : monthLabel}</h3><Link to={`/reports?month=${month}`} className="amount-link">Reports →</Link></div>
          {dashQuery.data && dashQuery.data.byCategory.length > 0
            ? <BarList items={dashQuery.data.byCategory.slice(0, 8).map((c) => ({ key: c.category, label: catName(c.category), value: c.total }))} />
            : <p className="empty">No spending recorded for {monthLabel}.</p>}
        </div>
        <div className="card">
          <div className="card-head"><h3>Budget by group</h3><Link to="/budgets" className="amount-link">Budget →</Link></div>
          {groups.length > 0 ? (
            <div className="budget-mini">
              {groups.map(([g, v]) => {
                const pct = v.budgeted > 0 ? Math.round((v.spent / v.budgeted) * 100) : (v.spent > 0 ? 100 : 0);
                return (
                  <div className="budget-mini-row" key={g}>
                    <div className="budget-mini-head"><span className="td-clip">{g}</span><span className="num muted">{formatGBP(v.spent)}{v.budgeted > 0 && ` / ${formatGBP(v.budgeted)}`}</span></div>
                    <div className="progress"><i className={barClass(pct)} style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                  </div>
                );
              })}
            </div>
          ) : <p className="empty">No budget categories yet.</p>}
        </div>
      </div>

      {/* ── Cash-flow trend ─────────────────────────────────────────────── */}
      {dashQuery.data && dashQuery.data.monthly.length > 1 && (
        <div className="card"><h3>Cash flow</h3><MonthlyBar data={dashQuery.data.monthly.slice(-6)} /></div>
      )}

      {/* ── Balances by account ─────────────────────────────────────────── */}
      <div className="card">
        <div className="card-head">
          <h3>Balances by account</h3>
          <Toggle checked={hideSmall} onChange={toggleHideSmall} label={<>Hide small (&lt;£100)</>} />
        </div>
        {banks.length === 0 && <p className="empty">No accounts yet.</p>}
        {banks.map((bank) =>
          bank.accounts
            .filter((a) => {
              if (accountId && a.id !== accountId) return false;
              if (hideSmall && Math.abs(a.currentBalance) < 100) return false;
              if (a.source === "INVESTMENT" && summary && !summary.included.investments) return false;
              if (a.source === "ASSET" && summary && !summary.included.assets) return false;
              if (a.source === "LIABILITY" && summary && !summary.included.debts) return false;
              return true;
            })
            .map((a) => {
              const delta = changes[a.id];
              return (
                <div key={`${a.id}-${syncNonce}-${delta ?? "x"}`} className={`lrow${delta != null ? " flash-update" : ""}`}>
                  <span className="lrow-acct">
                    <BrandLogo name={bank.institutionName} src={bank.institutionLogo} size={30} />
                    <span>{bank.institutionName} <span className="muted">— {a.displayName}</span></span>
                  </span>
                  <span className="num">
                    {delta != null && <span className={`delta-badge ${delta > 0 ? "pos" : "neg"}`}>{delta > 0 ? "+" : "−"}{formatMoney(Math.abs(delta))}</span>}
                    {a.currency ?? "GBP"} {formatMoney(a.currentBalance)}
                  </span>
                </div>
              );
            }),
        )}
      </div>
    </div>
  );
}

import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryState } from "nuqs";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { PiggyBank, Landmark, Wallet } from "lucide-react";
import { api } from "../api.ts";
import type { BankDTO, AuditEvent, SettingsDTO } from "../../../shared/types.ts";
import { formatGBP, formatMoney } from "../format.ts";
import { AccountSelector } from "../components/AccountSelector.tsx";
import { AuditSheet } from "../components/AuditSheet.tsx";
import { BrandLogo } from "../components/BrandLogo.tsx";
import { SpendBars } from "../components/charts/SpendBars.tsx";
import { BarList } from "../components/BarList.tsx";
import { Upcoming } from "../components/Upcoming.tsx";
import { RecentActivity } from "../components/RecentActivity.tsx";
import { TopMerchants } from "../components/TopMerchants.tsx";
import { PageHeader, Stat, StatPie, Toggle, Customizable, SortableBlock } from "../components/ui";

// Canonical dashboard section order (fallback before settings load).
const DEFAULT_ORDER = ["hero", "stats", "goals", "recentActivity", "upcoming", "spending", "topMerchants", "cashflow", "balances"];

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

export default function Dashboard({ minimal = false, editing: editingProp, onEditingChange }: { minimal?: boolean; editing?: boolean; onEditingChange?: (v: boolean) => void }) {
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
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => api.settings() });

  // Per-account balances list (with bank logos + post-sync flash).
  const [banks, setBanks] = useState<BankDTO[]>([]);
  const loadBanks = useCallback(() => { api.accounts().then(setBanks).catch(() => setBanks([])); }, []);
  useEffect(() => { loadBanks(); }, [loadBanks]);

  const reload = () => {
    qc.invalidateQueries({ queryKey: ["summary"] });
    qc.invalidateQueries({ queryKey: ["accounts-health"] });
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

  // ── Customize mode: show/hide dashboard cards (persisted as dashboard.show.* settings).
  // Optionally controlled by the parent (the home view hoists this so the toggle
  // can live in the account strip header); falls back to local state otherwise.
  const [editingInternal, setEditingInternal] = useState(false);
  const editing = editingProp ?? editingInternal;
  const setEditing = (v: boolean) => (onEditingChange ?? setEditingInternal)(v);
  const show = (key: string) => settings?.values[key] ?? true; // default on while loading
  const settingsMut = useMutation({
    mutationFn: (patch: Record<string, boolean>) => api.patchSettings(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ["settings"] });
      const prev = qc.getQueryData<SettingsDTO>(["settings"]);
      if (prev) qc.setQueryData<SettingsDTO>(["settings"], { ...prev, values: { ...prev.values, ...patch } });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["settings"], ctx.prev); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ["settings"] }); },
  });
  const setCard = (key: string, value: boolean) => settingsMut.mutate({ [key]: value });

  // Section order (drag-to-reorder in Customize mode), persisted as dashboard.order.
  const order = settings?.order ?? DEFAULT_ORDER;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const orderMut = useMutation({
    mutationFn: (next: string[]) => api.setDashboardOrder(next),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: ["settings"] });
      const prev = qc.getQueryData<SettingsDTO>(["settings"]);
      if (prev) qc.setQueryData<SettingsDTO>(["settings"], { ...prev, order: next });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["settings"], ctx.prev); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ["settings"] }); },
  });
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(String(active.id));
    const newIndex = order.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    orderMut.mutate(arrayMove(order, oldIndex, newIndex));
  };

  const catName = useMemo(() => {
    const m = new Map((catNames ?? []).map((c) => [c.key, c.name] as const));
    return (key: string) => m.get(key) ?? key;
  }, [catNames]);

  // ── The reassurance maths ────────────────────────────────────────────────
  const netWorth = summary?.netWorth ?? 0;
  const liquid = summary?.liquid ?? 0;           // bank + cash toward net worth
  const available = summary?.available ?? 0;     // spendable (excludes not-budgeted)
  const billsDue = upcoming?.billsDueThisMonth ?? 0;
  const billsDueCount = useMemo(() => {
    if (!upcoming) return 0;
    const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10);
    return upcoming.items.filter((i) => i.direction === "out" && i.date <= monthEnd).length;
  }, [upcoming]);
  // Pay-date reassurance: income still expected this month (shown on the stat cards).
  const incomeDue = upcoming?.incomeDueThisMonth ?? 0;
  const dayShort = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  // Income can arrive on several dates (e.g. a partner's transfer mid-month, a
  // wage at month-end). Show "by <last date>" when it spans dates, "~<date>" for
  // a single payment — never imply it all lands on the soonest date.
  const payLabel = useMemo(() => {
    const ymNow = nowMonth();
    const dates = [...new Set((upcoming?.items ?? []).filter((i) => i.direction === "in" && i.date.slice(0, 7) === ymNow).map((i) => i.date))].sort();
    if (!dates.length) return "";
    return dates.length > 1 ? `by ${dayShort(dates[dates.length - 1])}` : `~${dayShort(dates[0])}`;
  }, [upcoming]);
  // Rounded GBP for supporting lines — keeps the hero from looking dense.
  const gbp0 = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

  const spent = budget?.summary.spent ?? 0;
  const budgeted = budget?.summary.budgeted ?? 0;
  const income = budget?.summary.income ?? 0;
  const net = income - spent;
  const budgetPct = budgeted > 0 ? Math.round((spent / budgeted) * 100) : (spent > 0 ? 100 : 0);
  const overBudget = budgeted > 0 && spent > budgeted;
  const budgetLeft = budgeted - spent;
  // Stacked budget bar: green = already spent, yellow = upcoming bills still due.
  const spentW = budgeted > 0 ? Math.min(100, (spent / budgeted) * 100) : (spent > 0 ? 100 : 0);
  const billsW = budgeted > 0 ? Math.min(100 - spentW, (billsDue / budgeted) * 100) : 0;
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

  // Savings rate: share of income kept this month, vs last month (in points).
  // Floored at 0 — overspending shows as 0% saved, never a negative rate.
  const savingsRate = income > 0 ? Math.max(0, Math.round((net / income) * 100)) : 0;
  const prevRate = prevIncome > 0 ? Math.max(0, ((prevIncome - prevSpent) / prevIncome) * 100) : null;
  const savingsDelta: { node: string; tone: "muted" | "pos" | "neg" } = (() => {
    if (prevRate == null) return { node: net > 0 ? `${formatGBP(net)} saved` : "vs last month", tone: "muted" };
    const d = Math.round(savingsRate - prevRate);
    if (d === 0) return { node: "— vs last month", tone: "muted" };
    return { node: `${d > 0 ? "↑" : "↓"} ${Math.abs(d)}pts vs last month`, tone: d > 0 ? "pos" : "neg" };
  })();

  // ── Stat-tile enrichment: a % badge + a breakdown bar per tile ───────────
  const expectedIncome = income + incomeDue;
  const incomePct = expectedIncome > 0 ? Math.round((income / expectedIncome) * 100) : (income > 0 ? 100 : 0);
  const showIncomeProgress = month === nowMonth() && incomeDue > 0; // only meaningful while income is still landing
  const projectedPct = budgeted > 0 ? Math.round(((spent + billsDue) / budgeted) * 100) : null;
  // Solid fill + diagonal-shaded remainder, tinted to the tone (--bar).
  const TONE: Record<string, string> = { ok: "var(--jade)", warn: "var(--amber)", over: "var(--coral)" };
  const statBar = (tone: string, pct: number) => (
    <div className="progress hatched stat-bar" style={{ "--bar": TONE[tone] ?? TONE.ok } as CSSProperties}>
      <i style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: TONE[tone] ?? TONE.ok }} />
    </div>
  );
  // Upcoming tile: spent-so-far (coral) + bills still due (amber); the shaded
  // remainder (tinted jade) is the budget still uncommitted.
  const upcomingBar = budgeted > 0 ? (
    <div className="progress stack hatched stat-bar" style={{ "--bar": "var(--jade)" } as CSSProperties}>
      <i className={barClass(budgetPct)} style={{ width: `${spentW}%` }} />
      {billsW > 0 && <i className="upcoming" style={{ width: `${billsW}%` }} />}
    </div>
  ) : undefined;

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

  // Each dashboard section as an independently orderable block. A falsy entry
  // (gated out by data) is skipped; visibility within a block is handled by the
  // per-card <Customizable> toggles.
  const blocks: Record<string, ReactNode> = {
    hero: summary && (
      <Customizable label={minimal ? "Budget" : "Net worth & budget"} editing={editing} on={show("dashboard.show.hero")} onToggle={(v) => setCard("dashboard.show.hero", v)}>
        <div className={`card hero${minimal ? " hero-budget" : ""}${minimal && overBudget ? " hero-over" : ""}`}>
          {/* In the home view the net-worth column is dropped (net worth lives in
              the account strip up top) and the budget becomes the focused figure. */}
          {!minimal && (
            <div className="hero-main">
              <span className="hero-eyebrow">
                <span className="hero-chip ok"><Wallet size={13} strokeWidth={2.2} />Net worth</span>
                Everything you're worth
              </span>
              <span className="hero-figure num">{formatGBP(netWorth)}</span>
              <span className="hero-breakdown">
                {formatGBP(liquid)} in the bank <span className="muted">({gbp0(available)} available)</span>
              </span>
            </div>
          )}
          <div className={minimal ? "hero-main" : "hero-side"}>
            {minimal && (
              <span className="hero-eyebrow">
                <span className={`hero-chip ${overBudget ? "over" : "ok"}`}><Wallet size={13} strokeWidth={2.2} />Budget</span>
                {overBudget ? "Over budget this month" : "Left to spend this month"}
              </span>
            )}
            <span className={`hero-figure num ${overBudget ? "neg" : ""}`}>{gbp0(Math.abs(budgetLeft))}<span className="hero-figure-unit">{overBudget ? "over" : "left"}</span></span>
            <div className="progress stack">
              <i className={barClass(budgetPct)} style={{ width: `${spentW}%` }} />
              {billsW > 0 && <i className="upcoming" style={{ width: `${billsW}%` }} title="Upcoming bills" />}
            </div>
            <span className="hero-pace">
              {budgeted > 0 ? `${gbp0(spent)} of ${gbp0(budgeted)} · ${budgetPct}% used · ${elapsed}% of month` : "No budget set yet"}
              {billsDue > 0 && <> · <span className="upcoming-dot" />{gbp0(billsDue)} bills due</>}
            </span>
          </div>
        </div>
      </Customizable>
    ),
    stats: summary && (
      <div className="grid grid-fill">
        <Customizable label="Income" editing={editing} on={show("dashboard.show.statIncome")} onToggle={(v) => setCard("dashboard.show.statIncome", v)}>
          <Stat
            label="Income"
            value={formatGBP(income)}
            valueTone="pos"
            badge={showIncomeProgress ? `${incomePct}%` : undefined}
            bar={showIncomeProgress ? statBar("ok", incomePct) : undefined}
            delta={isThisMonth && incomeDue > 0 ? `+${formatGBP(incomeDue)} expected${payLabel ? ` ${payLabel}` : ""}` : incomeMom.node}
            deltaTone={isThisMonth && incomeDue > 0 ? "pos" : incomeMom.tone}
          />
        </Customizable>
        <Customizable label="Spent" editing={editing} on={show("dashboard.show.statSpent")} onToggle={(v) => setCard("dashboard.show.statSpent", v)}>
          <Stat
            label={`Spent · ${isThisMonth ? "this month" : monthLabel}`}
            value={formatGBP(spent)}
            valueTone="neg"
            badge={budgeted > 0 ? `${budgetPct}%` : undefined}
            bar={budgeted > 0 ? statBar(barClass(budgetPct), Math.min(budgetPct, 100)) : undefined}
            delta={spentMom.node}
            deltaTone={spentMom.tone}
          />
        </Customizable>
        <Customizable label="Upcoming" editing={editing} on={show("dashboard.show.statUpcoming")} onToggle={(v) => setCard("dashboard.show.statUpcoming", v)}>
          <Stat
            label="Upcoming · rest of month"
            value={formatGBP(billsDue)}
            valueTone="neg"
            badge={projectedPct != null ? `${projectedPct}% proj.` : undefined}
            bar={upcomingBar}
            delta={`${incomeDue > 0 ? `+${formatGBP(incomeDue)} in · ` : ""}${billsDueCount} bill${billsDueCount === 1 ? "" : "s"} left`}
          />
        </Customizable>
        <Customizable label="Net this month" editing={editing} on={show("dashboard.show.statNet")} onToggle={(v) => setCard("dashboard.show.statNet", v)}>
          <Stat label="Net this month" value={formatGBP(net)} valueTone={net < 0 ? "neg" : "pos"} delta={netMom.node} deltaTone={netMom.tone} />
        </Customizable>
        <Customizable label="Savings rate" editing={editing} on={show("dashboard.show.statSavingsRate")} onToggle={(v) => setCard("dashboard.show.statSavingsRate", v)}>
          <Stat
            label="Savings rate"
            value={`${savingsRate}%`}
            valueTone={savingsRate >= 0 ? "pos" : "neg"}
            side={<StatPie value={Math.max(0, savingsRate)} fill />}
            delta={savingsDelta.node}
            deltaTone={savingsDelta.tone}
          />
        </Customizable>
      </div>
    ),
    goals: ((debts && debts.totalOwed > 0) || pots) ? (
      <div className="grid grid-fill">
        {debts && debts.totalOwed > 0 && (
          <Customizable label="Debt goal" editing={editing} on={show("dashboard.show.goalDebt")} onToggle={(v) => setCard("dashboard.show.goalDebt", v)}>
            <Link to="/debts" className="card goal-card">
              <div className="goal-head"><span className="goal-ico debt"><Landmark size={16} strokeWidth={1.9} /></span><h3>Debt</h3><span className="num neg">{formatGBP(debts.totalOwed)}</span></div>
              <div className="progress"><i className="ok" style={{ width: `${Math.min(debtProgress, 100)}%` }} /></div>
              <span className="muted goal-sub">{formatGBP(debts.totalPaid)} repaid · {debtFreeMonths ? `debt-free ${payoffLabel(debtFreeMonths)}` : "log payments to project"}</span>
            </Link>
          </Customizable>
        )}
        {pots && (
          <Customizable label="Savings goal" editing={editing} on={show("dashboard.show.goalSavings")} onToggle={(v) => setCard("dashboard.show.goalSavings", v)}>
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
          </Customizable>
        )}
      </div>
    ) : null,
    upcoming: upcoming && (
      <Customizable label="Upcoming bills & income" editing={editing} on={show("dashboard.show.upcoming")} onToggle={(v) => setCard("dashboard.show.upcoming", v)}>
        <Upcoming data={upcoming} monthOnly />
      </Customizable>
    ),
    spending: (
      <div className="grid grid-fill">
        <Customizable label="Where it went" editing={editing} on={show("dashboard.show.spendingCategories")} onToggle={(v) => setCard("dashboard.show.spendingCategories", v)}>
          <div className="card">
            <div className="card-head"><h3>Where it went · {isThisMonth ? "this month" : monthLabel}</h3><Link to={`/reports?month=${month}`} className="amount-link">Reports →</Link></div>
            {dashQuery.data && dashQuery.data.byCategory.length > 0
              ? <BarList items={dashQuery.data.byCategory.slice(0, 8).map((c) => ({ key: c.category, label: catName(c.category), value: c.total }))} />
              : <p className="empty">No spending recorded for {monthLabel}.</p>}
          </div>
        </Customizable>
        <Customizable label="Budget by group" editing={editing} on={show("dashboard.show.budgetGroups")} onToggle={(v) => setCard("dashboard.show.budgetGroups", v)}>
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
        </Customizable>
      </div>
    ),
    topMerchants: dashQuery.data && (
      <Customizable label="Top merchants" editing={editing} on={show("dashboard.show.topMerchants")} onToggle={(v) => setCard("dashboard.show.topMerchants", v)}>
        <TopMerchants items={dashQuery.data.topMerchants} month={month} />
      </Customizable>
    ),
    recentActivity: (
      <Customizable label="Recent activity" editing={editing} on={show("dashboard.show.recentActivity")} onToggle={(v) => setCard("dashboard.show.recentActivity", v)}>
        <RecentActivity accountId={accountId} />
      </Customizable>
    ),
    cashflow: dashQuery.data && dashQuery.data.monthly.length > 1 && (
      <Customizable label="Spending" editing={editing} on={show("dashboard.show.cashflow")} onToggle={(v) => setCard("dashboard.show.cashflow", v)}>
        <div className="card">
          <div className="card-head"><h3>Spending</h3></div>
          <SpendBars data={dashQuery.data.monthly.slice(-12)} activeMonth={month} />
        </div>
      </Customizable>
    ),
    // In the home view the account strip up top already lists every balance, so
    // this card is dropped to avoid duplication.
    balances: minimal ? null : (
      <Customizable label="Balances by account" editing={editing} on={show("dashboard.show.balances")} onToggle={(v) => setCard("dashboard.show.balances", v)}>
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
      </Customizable>
    ),
  };
  const visibleKeys = order.filter((k) => blocks[k]);

  return (
    <div>
      {!minimal && (
        <PageHeader
          title="Dashboard"
          actions={<>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: "auto" }} aria-label="Month" />
            <AccountSelector />
            <button className={editing ? "btn-primary" : ""} onClick={() => setEditing(!editing)}>{editing ? "Done" : "Customize"}</button>
            <button className="btn-primary" onClick={() => setSyncOpen(true)} disabled={syncOpen}>Sync now</button>
          </>}
        />
      )}
      {!minimal && <AuditSheet open={syncOpen} title="Sync" run={syncRun} onClose={() => setSyncOpen(false)} onDone={reload} />}
      {editing && <p className="muted customize-hint">Drag the grip to reorder sections; use each card's switch to show or hide it.</p>}

      {editing ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={visibleKeys} strategy={verticalListSortingStrategy}>
            {visibleKeys.map((k) => <SortableBlock key={k} id={k}>{blocks[k]}</SortableBlock>)}
          </SortableContext>
        </DndContext>
      ) : (
        visibleKeys.map((k) => <Fragment key={k}>{blocks[k]}</Fragment>)
      )}
    </div>
  );
}

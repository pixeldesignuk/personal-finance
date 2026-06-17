import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Link, useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { api } from "../api.ts";
import type { TransactionDTO, BudgetRowDTO } from "../../../shared/types.ts";
import { formatGBP, relativeDate } from "../format.ts";
import { categoryClass, type SpendClass } from "../categoryMeta.ts";
import { isRefundNote } from "../../../shared/refund.ts";
import { BrandLogo } from "../components/BrandLogo.tsx";
import { AddTransaction } from "../components/AddTransaction.tsx";
import { TxnDrawer } from "../components/TxnDrawer.tsx";
import { useTxnEditing } from "../hooks/useTxnEditing.ts";
import { Plus, SlidersHorizontal, Clock, Send, Flag } from "lucide-react";

type Sort = "newest" | "oldest" | "largest" | "smallest";
const CLASS_PILLS: { key: SpendClass; label: string }[] = [
  { key: "needs", label: "Needs" },
  { key: "wants", label: "Wants" },
  { key: "savings", label: "Savings" },
];

const txnName = (r: TransactionDTO) => r.name?.trim() || r.remittanceInfo?.trim() || "Unknown";
// "Due to come out" — a pending bank entry or a future-dated debit that hasn't
// actually left the account yet. Today in UK-local YYYY-MM-DD to compare dates.
const todayISO = () => new Date().toLocaleDateString("en-CA");
const isDue = (r: TransactionDTO, today: string) => r.status === "pending" || (r.bookingDate != null && r.bookingDate > today);
// Day key + heading. Bank txns are dateless-of-time, so we group by the date.
const dayKey = (iso: string | null) => iso ?? "—";

export default function TransactionsHome() {
  const [params] = useSearchParams();
  const accountId = params.get("account") ?? undefined;

  const [q, setQ] = useQueryState("q", { defaultValue: "", history: "replace" });
  const [debouncedQ, setDebouncedQ] = useState(q);
  useEffect(() => { const t = setTimeout(() => setDebouncedQ(q), 250); return () => clearTimeout(t); }, [q]);

  const [personFilter, setPersonFilter] = useQueryState("person", { defaultValue: "", history: "replace" });
  const [catFilter, setCatFilter] = useQueryState("category", { defaultValue: "", history: "replace" });
  const [month, setMonth] = useQueryState("month", { defaultValue: "", history: "replace" });
  const [merchant, setMerchant] = useQueryState("merchant", { defaultValue: "", history: "replace" });
  const [klass, setKlass] = useQueryState("class", { defaultValue: "", history: "replace" });
  const [sort, setSort] = useQueryState("sort", { defaultValue: "newest", history: "replace" });
  // List is the default; the grid variation is still reachable via ?view=cards
  // (the in-page toggle is hidden for now).
  const [view] = useQueryState("view", { defaultValue: "list", history: "replace" });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const navigate = useNavigate();

  const edit = useTxnEditing();
  const { catNames, people, liabilities, debtName, nameOptions, bankByAccount, invalidateTxns } = edit;
  const listView = view === "list";

  const txnQuery = useQuery({
    queryKey: ["transactions", debouncedQ, accountId, personFilter, month, merchant] as const,
    queryFn: () => api.transactions(debouncedQ, accountId, personFilter || undefined, month || undefined, merchant || undefined),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => txnQuery.data ?? [], [txnQuery.data]);

  const unreconciledCount = useMemo(() => rows.filter((r) => r.category === "uncategorised" && !isRefundNote(r.note)).length, [rows]);

  // Current-month budget envelopes, keyed by category, so a row can flag its
  // impact on that category's budget. Only the live month is meaningful for
  // envelope budgeting — past months are historical, not actionable.
  const currentMonth = todayISO().slice(0, 7);
  const budgetQuery = useQuery({ queryKey: ["budget", "current"], queryFn: () => api.budget(), staleTime: 60_000 });
  const budgetByCat = useMemo(() => {
    const m = new Map<string, BudgetRowDTO>();
    for (const row of budgetQuery.data?.rows ?? []) m.set(row.key, row);
    return m;
  }, [budgetQuery.data]);

  // The newest current-month transaction of each budgeted category — the single
  // row that carries that category's budget flag. (We can't reliably reconstruct
  // a per-transaction running total client-side: the budget engine excludes
  // transfers/refunds/debt repayments that a naive per-row sum would wrongly
  // count — so we anchor to the authoritative /api/budget figures instead.)
  const newestByCat = useMemo(() => {
    const best = new Map<string, { id: string; date: string; idx: number }>();
    rows.forEach((r, idx) => {
      if (Number(r.amount) >= 0) return; // income/refund
      if ((r.bookingDate ?? "").slice(0, 7) !== currentMonth) return; // live month only
      const b = budgetByCat.get(r.category);
      if (!b || b.budgeted <= 0) return;
      const date = r.bookingDate ?? "";
      const cur = best.get(r.category);
      // Newest = latest date; on a date tie, the topmost row (newest-first list →
      // smallest idx) wins.
      if (!cur || date > cur.date || (date === cur.date && idx < cur.idx)) {
        best.set(r.category, { id: r.id, date, idx });
      }
    });
    const m = new Map<string, string>();
    for (const [cat, v] of best) m.set(cat, v.id);
    return m;
  }, [rows, budgetByCat, currentMonth]);

  // One quiet flag per category, on its newest purchase: amber (no text) as it
  // approaches the cap, or red WITH the over amount once it's blown. Authoritative
  // figures, so a 39%-spent category never falsely flags.
  const budgetFlag = (r: TransactionDTO): { tone: "near" | "over"; text?: string } | null => {
    if (newestByCat.get(r.category) !== r.id) return null;
    const b = budgetByCat.get(r.category);
    if (!b) return null;
    if (b.left < 0) return { tone: "over", text: `${formatGBP(-b.left)} over` };
    if (b.percent >= 85) return { tone: "near" };
    return null;
  };

  // Client-side filter (class pills, category) + sort.
  const visible = useMemo(() => {
    let v = rows.filter((r) =>
      (!catFilter || r.category === catFilter) &&
      (!klass || categoryClass(r.category) === klass),
    );
    const byAmt = (r: TransactionDTO) => Math.abs(Number(r.amount));
    const byDate = (r: TransactionDTO) => r.bookingDate ?? "";
    v = [...v].sort((a, b) => {
      switch (sort as Sort) {
        case "oldest": return byDate(a).localeCompare(byDate(b));
        case "largest": return byAmt(b) - byAmt(a);
        case "smallest": return byAmt(a) - byAmt(b);
        default: return byDate(b).localeCompare(byDate(a));
      }
    });
    return v;
  }, [rows, catFilter, klass, sort]);

  // Group consecutive (already-sorted) rows by day, preserving sort order.
  // Track income and outgoing separately — a single net figure (in − out) is
  // counterintuitive at a glance, so the day header shows both sides.
  const groups = useMemo(() => {
    const out: { key: string; label: string; inSum: number; outSum: number; rows: TransactionDTO[] }[] = [];
    for (const r of visible) {
      const k = dayKey(r.bookingDate);
      let g = out[out.length - 1];
      if (!g || g.key !== k) { g = { key: k, label: r.bookingDate ? relativeDate(r.bookingDate) : "No date", inSum: 0, outSum: 0, rows: [] }; out.push(g); }
      g.rows.push(r);
      const amt = Number(r.amount);
      if (amt >= 0) g.inSum += amt; else g.outSum += amt;
    }
    return out;
  }, [visible]);

  const [drawerId, setDrawerId] = useState<string | null>(null);
  const drawerTxn = useMemo(() => visible.find((t) => t.id === drawerId) ?? null, [visible, drawerId]);

  const isLoading = txnQuery.isLoading;
  const today = todayISO();

  return (
    <div className="txnv2">
      <div className="txnv2-head">
        <h1>Transactions</h1>
      </div>

      {/* Search + Review */}
      <div className="txnv2-search">
        <input className="txnv2-search-input" placeholder="Search transactions…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="txnv2-review" onClick={() => navigate("/transactions/review")}>
          Review{unreconciledCount > 0 && <span className="txnv2-badge">{unreconciledCount}</span>}
        </button>
      </div>

      {/* Sort & Filter chip + class pills */}
      <div className="txnv2-pills">
        <button type="button" className={`txnv2-chip${filtersOpen ? " is-active" : ""}`} onClick={() => setFiltersOpen((v) => !v)}>
          <SlidersHorizontal size={14} strokeWidth={2.2} /> Sort &amp; Filter
        </button>
        {CLASS_PILLS.map((p) => (
          <button key={p.key} type="button" className={`txnv2-pill cls-${p.key}${klass === p.key ? " is-active" : ""}`} onClick={() => setKlass(klass === p.key ? "" : p.key)}>
            <span className="txnv2-dot" /> {p.label}
          </button>
        ))}
      </div>

      {filtersOpen && (
        <div className="txnv2-filters">
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="largest">Largest amount</option>
            <option value="smallest">Smallest amount</option>
          </select>
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
            <option value="">All categories</option>
            {catNames.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
          <select value={personFilter} onChange={(e) => setPersonFilter(e.target.value)}>
            <option value="">Everyone</option>
            <option value="none">Unassigned</option>
            {people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} title="Filter by month" />
          {merchant && <button className="btn-sm" onClick={() => setMerchant("")}>Merchant: {merchant} ✕</button>}
        </div>
      )}

      {isLoading ? (
        <p className="empty">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="txnv2-grid">
          <NewTxnTile onAdded={invalidateTxns} />
          <p className="empty txnv2-empty">No transactions match.</p>
        </div>
      ) : (
        groups.map((g, gi) => (
          <section key={g.key} className="txnv2-day">
            <div className="txnv2-day-head">
              <span>{g.label}</span>
              {/* Daily In/Out totals hidden for now — re-enable when wanted.
              <span className="txnv2-day-sums">
                {g.outSum < 0 && <span className="txnv2-day-sum is-out"><ArrowUp size={12} strokeWidth={2.8} /><span className="num">{formatGBP(Math.abs(g.outSum))}</span></span>}
                {g.inSum > 0 && <span className="txnv2-day-sum is-in"><ArrowDown size={12} strokeWidth={2.8} /><span className="num">{formatGBP(g.inSum)}</span></span>}
              </span> */}
            </div>
            {listView ? (
              <div className="txnv2-list">
                {gi === 0 && <NewTxnRow onAdded={invalidateTxns} />}
                {g.rows.map((r) => {
                  const amt = Number(r.amount);
                  const income = amt > 0;
                  const name = txnName(r);
                  const catName = catNames.find((c) => c.key === r.category)?.name ?? "";
                  const due = isDue(r, today);
                  const tg = r.origin === "telegram" || r.origin === "receipt";
                  const bank = bankByAccount[r.accountId];
                  const sub = [due ? "Pending" : "", catName].filter(Boolean).join(" · ");
                  const flag = budgetFlag(r);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className={`txnv2-lrow${r.flag ? ` flag-${r.flag}` : ""}${due ? " is-due" : ""}`}
                      onClick={() => setDrawerId(r.id)}
                    >
                      <span className="txnv2-lrow-av">
                        <BrandLogo name={name} src={r.logoUrl} size={44} />
                        <span className="txnv2-lrow-badge">
                          {tg
                            ? <span className="tg-avatar" title="Added via Telegram"><Send size={11} strokeWidth={2.4} /></span>
                            : <BrandLogo name={bank?.name ?? r.accountName} src={bank?.logo} size={20} />}
                        </span>
                      </span>
                      <span className="txnv2-lrow-main">
                        <span className="txnv2-lrow-name">{name}</span>
                        <span className="txnv2-lrow-sub muted">
                          {due && <Clock size={11} strokeWidth={2.6} />}{sub}
                          {flag && (
                            <span
                              className={`txnv2-flag is-${flag.tone}${flag.text ? " has-text" : ""}`}
                              title={flag.text ? `${catName} ${flag.text} budget` : `Approaching ${catName} budget`}
                            >
                              <Flag size={11} strokeWidth={0} fill="currentColor" />
                              {flag.text && <span className="txnv2-flag-text">{flag.text}</span>}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className={`num txnv2-lrow-amt ${income ? "pos" : "neg"}`}>{income ? "+" : "−"}{formatGBP(Math.abs(amt))}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="txnv2-grid">
                {gi === 0 && <NewTxnTile onAdded={invalidateTxns} />}
                {g.rows.map((r) => {
                  const amt = Number(r.amount);
                  const income = amt > 0;
                  const cls = income ? null : categoryClass(r.category);
                  const name = txnName(r);
                  const catName = catNames.find((c) => c.key === r.category)?.name ?? "";
                  const due = isDue(r, today);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className={`txnv2-card${income ? " is-income" : cls ? ` cls-${cls}` : ""}${r.flag ? ` flag-${r.flag}` : ""}${due ? " is-due" : ""}`}
                      onClick={() => setDrawerId(r.id)}
                    >
                      <div className="txnv2-card-top">
                        <span className="txnv2-avatar">
                          <BrandLogo name={name} src={r.logoUrl} size={34} />
                          {due && <span className="txnv2-due-badge" title="Not yet settled"><Clock size={11} strokeWidth={2.6} /></span>}
                        </span>
                        <span className={`num txnv2-amt${income ? " pos" : ""}`}>{income ? "+" : ""}{formatGBP(amt)}</span>
                      </div>
                      <div className="txnv2-card-bottom">
                        <span className="txnv2-name">{name}</span>
                        <span className="txnv2-sub muted">{catName}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        ))
      )}

      {drawerTxn && (
        <TxnDrawer
          txn={drawerTxn}
          budget={Number(drawerTxn.amount) < 0 ? (budgetByCat.get(drawerTxn.category) ?? null) : null}
          onClose={() => setDrawerId(null)}
          catNames={catNames}
          people={people}
          liabilities={liabilities}
          debtName={debtName}
          nameOptions={nameOptions}
          onRename={(name) => edit.rename(drawerTxn.id, name)}
          onCategory={(key) => edit.setCategory(drawerTxn.id, key)}
          onPerson={(key) => edit.setPerson(drawerTxn.id, key)}
          onNote={(note) => edit.setNote(drawerTxn.id, note)}
          onFlag={(flag) => edit.setFlag(drawerTxn.id, flag as TransactionDTO["flag"])}
          onDelete={() => { edit.del(drawerTxn.id); setDrawerId(null); }}
          onLinkDebt={(debtId) => edit.linkDebt(drawerTxn.id, debtId)}
          onUnlinkDebt={() => edit.unlinkRepayment(drawerTxn.id)}
        />
      )}
    </div>
  );
}

function NewTxnTile({ onAdded }: { onAdded: () => void }) {
  return (
    <AddTransaction
      onAdded={onAdded}
      renderTrigger={(open) => (
        <button type="button" className="txnv2-card txnv2-new" onClick={open}>
          <span className="txnv2-new-icon"><Plus size={20} strokeWidth={2.4} /></span>
          <span className="txnv2-new-label">New Transaction</span>
        </button>
      )}
    />
  );
}

function NewTxnRow({ onAdded }: { onAdded: () => void }) {
  return (
    <AddTransaction
      onAdded={onAdded}
      renderTrigger={(open) => (
        <button type="button" className="txnv2-lrow txnv2-lrow-new" onClick={open}>
          <span className="txnv2-lrow-av">
            <span className="txnv2-new-icon txnv2-new-icon-row"><Plus size={20} strokeWidth={2.4} /></span>
          </span>
          <span className="txnv2-lrow-main"><span className="txnv2-lrow-name">New Transaction</span></span>
        </button>
      )}
    />
  );
}

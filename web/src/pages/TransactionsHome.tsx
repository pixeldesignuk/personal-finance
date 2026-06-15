import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Link, useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { api } from "../api.ts";
import type { TransactionDTO } from "../../../shared/types.ts";
import { formatGBP, relativeDate } from "../format.ts";
import { categoryClass, type SpendClass } from "../categoryMeta.ts";
import { isRefundNote } from "../../../shared/refund.ts";
import { BrandLogo } from "../components/BrandLogo.tsx";
import { AddTransaction } from "../components/AddTransaction.tsx";
import { TxnDrawer } from "../components/TxnDrawer.tsx";
import { useTxnEditing } from "../hooks/useTxnEditing.ts";
import { Plus, Send, SlidersHorizontal, Wallet } from "lucide-react";

type Sort = "newest" | "oldest" | "largest" | "smallest";
const CLASS_PILLS: { key: SpendClass; label: string }[] = [
  { key: "needs", label: "Needs" },
  { key: "wants", label: "Wants" },
  { key: "savings", label: "Savings" },
];

const txnName = (r: TransactionDTO) => r.name?.trim() || r.remittanceInfo?.trim() || "Unknown";
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const navigate = useNavigate();

  const edit = useTxnEditing();
  const { catNames, people, liabilities, debtName, nameOptions, bankByAccount, invalidateTxns } = edit;

  const txnQuery = useQuery({
    queryKey: ["transactions", debouncedQ, accountId, personFilter, month, merchant] as const,
    queryFn: () => api.transactions(debouncedQ, accountId, personFilter || undefined, month || undefined, merchant || undefined),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => txnQuery.data ?? [], [txnQuery.data]);

  const unreconciledCount = useMemo(() => rows.filter((r) => r.category === "uncategorised" && !isRefundNote(r.note)).length, [rows]);

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
  const groups = useMemo(() => {
    const out: { key: string; label: string; total: number; rows: TransactionDTO[] }[] = [];
    for (const r of visible) {
      const k = dayKey(r.bookingDate);
      let g = out[out.length - 1];
      if (!g || g.key !== k) { g = { key: k, label: r.bookingDate ? relativeDate(r.bookingDate) : "No date", total: 0, rows: [] }; out.push(g); }
      g.rows.push(r);
      g.total += Number(r.amount);
    }
    return out;
  }, [visible]);

  const [drawerId, setDrawerId] = useState<string | null>(null);
  const drawerTxn = useMemo(() => visible.find((t) => t.id === drawerId) ?? null, [visible, drawerId]);

  const isLoading = txnQuery.isLoading;

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
              <span className={`num ${g.total >= 0 ? "pos" : ""}`}>{g.total >= 0 ? "+" : ""}{formatGBP(g.total)}</span>
            </div>
            <div className="txnv2-grid">
              {gi === 0 && <NewTxnTile onAdded={invalidateTxns} />}
              {g.rows.map((r) => {
                const amt = Number(r.amount);
                const income = amt > 0;
                const cls = income ? null : categoryClass(r.category);
                const name = txnName(r);
                const catName = catNames.find((c) => c.key === r.category)?.name ?? "";
                const bank = bankByAccount[r.accountId];
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={`txnv2-card${income ? " is-income" : cls ? ` cls-${cls}` : ""}${r.flag ? ` flag-${r.flag}` : ""}`}
                    onClick={() => setDrawerId(r.id)}
                  >
                    <div className="txnv2-card-top">
                      <span className="txnv2-avatar">
                        {r.origin === "telegram" || r.origin === "receipt"
                          ? <span className="tg-avatar" title="Added via Telegram"><Send size={13} strokeWidth={2.2} /></span>
                          : <BrandLogo name={name} src={r.logoUrl} size={28} />}
                        {r.source === "MANUAL" ? (
                          <span className="txnv2-acct" title={r.accountName}>
                            <span className="txnv2-acct-cash"><Wallet size={10} strokeWidth={2.4} /></span>
                          </span>
                        ) : bank && (
                          <span className="txnv2-acct" title={r.accountName}>
                            <BrandLogo name={bank.name} src={bank.logo} size={15} />
                          </span>
                        )}
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
          </section>
        ))
      )}

      {drawerTxn && (
        <TxnDrawer
          txn={drawerTxn}
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

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ChevronDown, RotateCcw, Receipt, Wallet, Send } from "lucide-react";
import { api } from "../api.ts";
import type { TransactionDTO, CategoryNameDTO } from "../../../shared/types.ts";
import { formatGBP } from "../format.ts";
import { categoryClass, categoryMeta, type SpendClass } from "../categoryMeta.ts";
import { isRefundNote } from "../../../shared/refund.ts";
import { keywordCategories } from "../../../shared/categoryKeywords.ts";
import { BrandLogo } from "../components/BrandLogo.tsx";
import { useToast } from "../components/Toasts.tsx";

type Dir = "left" | "right" | "down";
const DIR_CLASS: Record<Dir, SpendClass> = { left: "wants", right: "needs", down: "savings" };
const CLASS_COLOR: Record<SpendClass, string> = { needs: "#7DA3FF", wants: "var(--amber)", savings: "var(--jade)" };
// Sensible catch-all category per class when a swipe lands without a chosen category.
const CLASS_DEFAULT: Record<SpendClass, string> = { needs: "groceries", wants: "shopping", savings: "savings-investments" };
const THRESHOLD = 92;

const txnName = (t: TransactionDTO) => t.name?.trim() || t.remittanceInfo?.trim() || "Unknown";
const isCredit = (t: TransactionDTO) => Number(t.amount) > 0; // money in (refund / income), not spend
const dayShort = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
const rangeLabel = (a: string | null, b: string | null) => {
  if (!a) return "";
  const f = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return a === b || !b ? f(a) : `${new Date(`${a}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${f(b)}`;
};

export default function TransactionReview() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { notify } = useToast();

  const { data: all } = useQuery({ queryKey: ["transactions", "review"], queryFn: () => api.transactions("", undefined, undefined, undefined, undefined), placeholderData: keepPreviousData });
  const catNamesQuery = useQuery({ queryKey: ["categoryNames"], queryFn: () => api.categoryNames(), staleTime: 5 * 60_000 });
  const catNames = useMemo<CategoryNameDTO[]>(() => (catNamesQuery.data ?? []).filter((c) => c.key !== "uncategorised"), [catNamesQuery.data]);

  // accountId → owning bank, so each card can show the account it belongs to.
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: () => api.accounts(), staleTime: 5 * 60_000 });
  const bankByAccount = useMemo(() => {
    const m: Record<string, { name: string; logo: string | null }> = {};
    for (const b of accountsQuery.data ?? []) for (const a of b.accounts) m[a.id] = { name: b.institutionName, logo: b.institutionLogo };
    return m;
  }, [accountsQuery.data]);

  // The queue is captured once (so cards don't reshuffle as we categorise).
  const [queue, setQueue] = useState<TransactionDTO[]>([]);
  const captured = useRef(false);
  useEffect(() => {
    if (!captured.current && all && catNamesQuery.data) {
      // Uncategorised, excluding credits already marked as a refund (a refund
      // needs no category, so it lives as an uncategorised txn with a refund note).
      setQueue(all.filter((t) => t.category === "uncategorised" && !isRefundNote(t.note)).sort((a, b) => (b.bookingDate ?? "").localeCompare(a.bookingDate ?? "")));
      captured.current = true;
    }
  }, [all, catNamesQuery.data]);

  const [index, setIndex] = useState(0);
  const [totals, setTotals] = useState<Record<string, number>>({ needs: 0, wants: 0, savings: 0, refund: 0, income: 0 });
  const [history, setHistory] = useState<{ id: string; action: "skip" | "assign"; bucket?: string; amount: number; hadNote?: boolean; revertCat?: boolean }[]>([]);
  const [selectedCat, setSelectedCat] = useState("");
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const [exit, setExit] = useState<Dir | null>(null);

  const top = queue[index] ?? null;
  const dateRange = useMemo(() => {
    const dates = queue.map((t) => t.bookingDate).filter(Boolean) as string[];
    if (!dates.length) return "";
    return rangeLabel(dates[dates.length - 1], dates[0]);
  }, [queue]);

  // Suggested category for the current card — only when the auto-categoriser
  // actually produced one. Otherwise empty, so the card shows "Choose category…"
  // rather than silently defaulting to whatever sits first in the list.
  const suggest = (t: TransactionDTO | null) => {
    if (!t) return "";
    if (t.autoCategory && t.autoCategory !== "uncategorised" && catNames.some((c) => c.key === t.autoCategory)) return t.autoCategory;
    return "";
  };
  useEffect(() => { setSelectedCat(suggest(top)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [top?.id, catNames.length]);

  // Category to file under when a swipe lands in `cls`: the auto-suggestion if it
  // belongs to that class, else the class's catch-all, else any category in it.
  const defaultForClass = (cls: SpendClass, t: TransactionDTO) => {
    if (t.autoCategory && categoryClass(t.autoCategory) === cls && catNames.some((c) => c.key === t.autoCategory)) return t.autoCategory;
    const pref = CLASS_DEFAULT[cls];
    if (catNames.some((c) => c.key === pref)) return pref;
    return catNames.find((c) => categoryClass(c.key) === cls)?.key ?? "";
  };

  // Suggested category chips for the top card: auto-category first, then only the
  // categories actually used by similarly-NAMED merchants, then the per-class
  // catch-alls. We deliberately do NOT fall back to "your most-used overall" —
  // that surfaces globally-popular categories (e.g. education) with zero relevance
  // to the merchant, which is exactly the bad guess we want to avoid.
  const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const suggestions = useMemo<string[]>(() => {
    if (!top) return [];
    const valid = (k: string) => k && k !== "uncategorised" && k !== "income" && k !== "transfer" && catNames.some((c) => c.key === k);
    // Match on the statement name and, when smart matching linked a receipt, the
    // order's clean merchant name too.
    const prefixes = [norm(txnName(top)).slice(0, 5), norm(top.order?.merchant ?? "").slice(0, 5)].filter((p) => p.length >= 4);
    const matchCount = new Map<string, number>();
    for (const t of all ?? []) {
      if (t.id === top.id || !valid(t.category)) continue;
      const tn = norm(txnName(t));
      if (prefixes.some((p) => tn.startsWith(p))) matchCount.set(t.category, (matchCount.get(t.category) ?? 0) + 1);
    }
    // Only categories with a real name-prefix match — never bare frequency.
    const relevant = [...matchCount.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    // Content signal: keywords on the merchant name, note/receipt summary and any
    // matched receipt line items ("creamery", "shake" → dining-out).
    const text = [txnName(top), top.note, top.order?.merchant, ...(top.order?.items.map((i) => i.name) ?? [])].filter(Boolean).join(" ");
    const out: string[] = [];
    const add = (k: string) => { if (valid(k) && !out.includes(k)) out.push(k); };
    if (top.autoCategory && top.autoCategory !== "uncategorised") add(top.autoCategory);
    relevant.forEach(add);
    keywordCategories(text).forEach(add);
    Object.values(CLASS_DEFAULT).forEach(add);
    return out.slice(0, 5);
  }, [top, all, catNames]);

  const saveCat = useMutation({
    mutationFn: ({ id, category }: { id: string; category: string }) => api.setTxnCategory(id, category),
    onError: () => notify("Couldn't save — will retry on exit", { tone: "error" }),
  });

  const advance = (dir: Dir, ms = 260) => { setExit(dir); window.setTimeout(() => { setIndex((i) => i + 1); setExit(null); setDrag({ x: 0, y: 0, active: false }); }, ms); };

  const commit = (dir: Dir) => {
    if (!top || exit) return;
    if (isCredit(top)) {
      // Credits: left = refund, right = income, down = skip. A refund just gets a
      // "refund" note (no category needed — we already know it's money back);
      // income is filed as income.
      if (dir === "down") return skip();
      const kind = dir === "left" ? "refund" : "income";
      const amount = Math.abs(Number(top.amount));
      if (kind === "refund") api.setTxnNote(top.id, `refund — ${txnName(top)}`.slice(0, 140)).catch(() => {});
      else saveCat.mutate({ id: top.id, category: "income" });
      setHistory((h) => [...h, { id: top.id, action: "assign", bucket: kind, amount, hadNote: kind === "refund", revertCat: kind === "income" }]);
      setTotals((tt) => ({ ...tt, [kind]: tt[kind] + amount }));
      advance(dir);
      return;
    }
    const cls = DIR_CLASS[dir];
    const category = categoryClass(selectedCat) === cls ? selectedCat : defaultForClass(cls, top);
    if (!category) return; // nothing sensible to assign
    const amount = Math.abs(Number(top.amount));
    saveCat.mutate({ id: top.id, category });
    setHistory((h) => [...h, { id: top.id, action: "assign", bucket: cls, amount, revertCat: true }]);
    setTotals((tt) => ({ ...tt, [cls]: tt[cls] + amount }));
    advance(dir);
  };

  const skip = () => {
    if (!top || exit) return;
    setHistory((h) => [...h, { id: top.id, action: "skip", amount: 0 }]);
    advance("down", 200);
  };

  const undo = () => {
    if (!history.length) return;
    const last = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setIndex((i) => Math.max(0, i - 1));
    if (last.action === "assign" && last.bucket) {
      setTotals((tt) => ({ ...tt, [last.bucket!]: Math.max(0, tt[last.bucket!] - last.amount) }));
      if (last.revertCat) api.setTxnCategory(last.id, "uncategorised").catch(() => {});
      if (last.hadNote) api.setTxnNote(last.id, null).catch(() => {});
    }
  };

  // Refresh the rest of the app once we leave the deck.
  useEffect(() => () => {
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["budget"] });
    qc.invalidateQueries({ queryKey: ["summary"] });
  }, [qc]);

  // ── Drag handlers (top card) ────────────────────────────────────────────
  const start = useRef<{ x: number; y: number } | null>(null);
  const pos = useRef({ x: 0, y: 0 }); // live offset, read on release (state may not have flushed)
  const onDown = (e: React.PointerEvent) => { if (exit) return; start.current = { x: e.clientX, y: e.clientY }; pos.current = { x: 0, y: 0 }; setDrag({ x: 0, y: 0, active: true }); try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ } };
  const onMove = (e: React.PointerEvent) => { if (!start.current) return; pos.current = { x: e.clientX - start.current.x, y: e.clientY - start.current.y }; setDrag({ ...pos.current, active: true }); };
  const onUp = () => {
    if (!start.current) return;
    start.current = null;
    const { x, y } = pos.current;
    if (y > THRESHOLD && y > Math.abs(x)) commit("down");
    else if (x > THRESHOLD) commit("right");
    else if (x < -THRESHOLD) commit("left");
    else setDrag({ x: 0, y: 0, active: false });
  };

  // Live direction hint while dragging.
  const hintDir: Dir | null = !drag.active ? null
    : drag.y > 40 && drag.y > Math.abs(drag.x) ? "down"
    : drag.x > 40 ? "right" : drag.x < -40 ? "left" : null;
  const hintClass = hintDir ? DIR_CLASS[hintDir] : null;

  const remaining = queue.length - index;
  const done = captured.current && remaining <= 0;

  return (
    <div className="rev">
      <header className="rev-head">
        <button type="button" className="rev-back" onClick={() => nav("/transactions/v2")} aria-label="Back"><ChevronLeft size={24} strokeWidth={2.2} /></button>
        <div className="rev-title">
          <h1>Review Transactions</h1>
          {dateRange && <span className="rev-range">{dateRange}</span>}
        </div>
        <span className="rev-back" aria-hidden />
      </header>

      {done ? (
        <div className="rev-done">
          <p className="rev-done-emoji">✓</p>
          <h2>All caught up</h2>
          <p className="muted">{history.filter((h) => h.action !== "skip").length} categorised{history.some((h) => h.action === "skip") ? ` · ${history.filter((h) => h.action === "skip").length} skipped` : ""}.</p>
          <button type="button" className="btn-primary" onClick={() => nav("/transactions/v2")}>Back to transactions</button>
        </div>
      ) : (
        <>
          <div className="rev-deck">
            {queue.slice(index, index + 3).map((t, i) => {
              const isTop = i === 0;
              const depth = i; // 0 = top
              const name = txnName(t);
              const bank = bankByAccount[t.accountId];
              const style: React.CSSProperties = isTop
                ? {
                    transform: exit
                      ? `translate(${exit === "left" ? -700 : exit === "right" ? 700 : 0}px, ${exit === "down" ? 700 : 0}px) rotate(${exit === "left" ? -18 : exit === "right" ? 18 : 0}deg)`
                      : `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x / 22}deg)`,
                    transition: drag.active ? "none" : "transform 0.26s cubic-bezier(0.4,0,0.2,1)",
                  }
                : { transform: `translateY(${depth * -56}px) scale(${1 - depth * 0.05})`, transformOrigin: "center bottom", opacity: 1 - depth * 0.06 };
              return (
                <article
                  key={t.id}
                  className={`rev-card${isTop ? " is-top" : ""}${isTop && hintClass ? ` hint-${hintClass}` : ""}`}
                  style={{ zIndex: 10 - depth, ...style }}
                  onPointerDown={isTop ? onDown : undefined}
                  onPointerMove={isTop ? onMove : undefined}
                  onPointerUp={isTop ? onUp : undefined}
                  onPointerCancel={isTop ? onUp : undefined}
                >
                  <div className="rev-card-row">
                    <span className="rev-avatar">
                      {t.origin === "telegram" || t.origin === "receipt"
                        ? <span className="tg-avatar rev-tg" title="Added via Telegram"><Send size={20} strokeWidth={2.2} /></span>
                        : <BrandLogo name={name} src={t.logoUrl} size={52} />}
                      {t.source === "MANUAL"
                        ? <span className="rev-acct" title={t.accountName}><span className="rev-acct-cash"><Wallet size={13} strokeWidth={2.4} /></span></span>
                        : bank && <span className="rev-acct" title={t.accountName}><BrandLogo name={bank.name} src={bank.logo} size={22} /></span>}
                    </span>
                    <div className="rev-card-id">
                      <span className="rev-card-name">{name}</span>
                      <span className="rev-card-date muted">{t.accountName} · {dayShort(t.bookingDate)}</span>
                    </div>
                    <span className={`num rev-card-amt${isCredit(t) ? " pos" : ""}`}>{isCredit(t) ? "+" : ""}{formatGBP(Math.abs(Number(t.amount)))}</span>
                  </div>
                  {isTop && t.order && (
                    <div className="rev-order" title={t.order.orderNumber ? `Order ${t.order.orderNumber}` : "Matched receipt"}>
                      <Receipt size={13} strokeWidth={2} />
                      <span className="rev-order-text">
                        {t.order.items.length
                          ? t.order.items.slice(0, 2).map((it) => it.name).join(", ") + (t.order.items.length > 2 ? ` +${t.order.items.length - 2} more` : "")
                          : t.order.merchant ? `${t.order.merchant} receipt` : "Matched receipt"}
                      </span>
                    </div>
                  )}
                  {isTop && !isCredit(t) && (
                    <div className="rev-chips" onPointerDown={(e) => e.stopPropagation()}>
                      {suggestions.map((key) => {
                        const meta = categoryMeta(key);
                        const ChipIcon = meta.Icon;
                        const sel = selectedCat === key;
                        const label = catNames.find((c) => c.key === key)?.name ?? key;
                        return (
                          <button
                            key={key} type="button"
                            className={`rev-chip${sel ? " is-sel" : ""}`}
                            style={sel ? { borderColor: meta.color, background: `color-mix(in srgb, ${meta.color} 20%, transparent)` } : undefined}
                            onClick={() => setSelectedCat(sel ? "" : key)}
                          >
                            <ChipIcon size={14} strokeWidth={2.3} color={meta.color} /> {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <div className="rev-meta">
            <button type="button" className="rev-meta-btn" onClick={undo} disabled={!history.length}><RotateCcw size={15} strokeWidth={2} /> Undo</button>
            <button type="button" className="rev-meta-btn" onClick={skip}>Skip</button>
            <span className="rev-count">{Math.min(index + 1, queue.length)} of {queue.length}</span>
          </div>

          {top && isCredit(top) ? (
            <div className="rev-actions">
              <button type="button" className={`rev-action cls-refund${hintDir === "left" ? " is-hint" : ""}`} style={{ ["--c" as string]: "var(--gold)" }} onClick={() => commit("left")}>
                <span className="rev-action-label"><RotateCcw size={15} strokeWidth={2.6} /> Refund</span>
                <span className="num rev-action-total">{formatGBP(totals.refund)}</span>
              </button>
              <button type="button" className={`rev-action cls-income${hintDir === "right" ? " is-hint" : ""}`} style={{ ["--c" as string]: "var(--jade)" }} onClick={() => commit("right")}>
                <span className="rev-action-label">Income <ChevronRight size={16} strokeWidth={2.6} /></span>
                <span className="num rev-action-total">{formatGBP(totals.income)}</span>
              </button>
            </div>
          ) : (
            <div className="rev-actions">
              {(["left", "down", "right"] as Dir[]).map((dir) => {
                const cls = DIR_CLASS[dir];
                const Icon = dir === "left" ? ChevronLeft : dir === "right" ? ChevronRight : ChevronDown;
                return (
                  <button key={dir} type="button" className={`rev-action cls-${cls}${hintDir === dir || categoryClass(selectedCat) === cls ? " is-hint" : ""}`} style={{ ["--c" as string]: CLASS_COLOR[cls] }} onClick={() => commit(dir)}>
                    <span className="rev-action-label">{dir !== "right" && <Icon size={16} strokeWidth={2.6} />}{cls === "needs" ? "Needs" : cls === "wants" ? "Wants" : "Savings"}{dir === "right" && <Icon size={16} strokeWidth={2.6} />}</span>
                    <span className="num rev-action-total">{formatGBP(totals[cls])}</span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useQueryState } from "nuqs";
import {
  AlertTriangle, Tag, Repeat, PiggyBank, Sparkles, MoreVertical, ChevronRight, Check, X,
} from "lucide-react";
import { api } from "../api.ts";
import type { InsightDTO, InsightKind, InsightAction } from "../../../shared/types.ts";

const ICON: Record<InsightKind, typeof Tag> = {
  overspent: AlertTriangle,
  needs_category: Tag,
  new_subscription: Repeat,
  surplus: PiggyBank,
  new_transactions: Sparkles,
};

const VARIANTS = [
  { key: "spotlight", label: "Spotlight" },
  { key: "carousel", label: "Carousel" },
  { key: "feed", label: "Feed" },
] as const;

// ISO timestamp `days` from now (server validates it's in the future).
const inDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
};

// Three side-by-side presentation patterns for the "Needs you" inbox, switchable
// via ?inbox= so we can compare them live and settle on one. They share the data
// query, the dismiss/snooze/read mutation, and the row/menu markup.
export function NeedsYou() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["insights"], queryFn: () => api.insights() });
  const [variant, setVariant] = useQueryState("inbox", { defaultValue: "spotlight" });
  const [menuId, setMenuId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const act = useMutation({
    mutationFn: ({ id, action, until }: { id: string; action: InsightAction; until?: string }) =>
      api.patchInsight(id, action, until),
    onMutate: async ({ id, action }) => {
      setMenuId(null);
      if (action === "read") return; // read doesn't remove the row from the inbox
      await qc.cancelQueries({ queryKey: ["insights"] });
      const prev = qc.getQueryData<InsightDTO[]>(["insights"]);
      qc.setQueryData<InsightDTO[]>(["insights"], (old) => (old ?? []).filter((i) => i.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["insights"], ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["insights"] }),
  });

  if (!data) return null;

  const switcher = (
    <div className="inbox-switch">
      {VARIANTS.map((v) => (
        <button key={v.key} type="button" className={variant === v.key ? "is-active" : ""} onClick={() => setVariant(v.key)}>{v.label}</button>
      ))}
    </div>
  );
  const head = (
    <div className="flat-head">
      <div className="flat-head-titles"><h3>Needs you</h3></div>
      {switcher}
    </div>
  );

  if (data.length === 0) {
    return (
      <div className="flat-list needs-you">
        {head}
        <p className="needs-clear muted"><Check size={15} strokeWidth={2.4} /> You&rsquo;re all caught up</p>
      </div>
    );
  }

  // The ⋮ popover for a row/card (in-app; scrim catches outside clicks).
  const menu = (it: InsightDTO) => menuId === it.id && (
    <>
      <div className="needs-menu-scrim" onClick={() => setMenuId(null)} />
      <div className="needs-menu" role="menu">
        <button type="button" onClick={() => act.mutate({ id: it.id, action: "dismiss" })}>Dismiss</button>
        <button type="button" onClick={() => act.mutate({ id: it.id, action: "snooze", until: inDays(1) })}>Snooze 1 day</button>
        <button type="button" onClick={() => act.mutate({ id: it.id, action: "snooze", until: inDays(7) })}>Snooze 1 week</button>
      </div>
    </>
  );

  const menuBtn = (it: InsightDTO) => (
    <button type="button" className="needs-menu-btn" aria-label="More" onClick={() => setMenuId(menuId === it.id ? null : it.id)}>
      <MoreVertical size={16} strokeWidth={2.2} />
    </button>
  );

  // Full-width list row (used by spotlight + feed sheet).
  const row = (it: InsightDTO) => {
    const Icon = ICON[it.kind];
    return (
      <div key={it.id} className={`needs-row sev-${it.severity}`}>
        <Link to={it.link} className="needs-row-main" onClick={() => act.mutate({ id: it.id, action: "read" })}>
          <span className="needs-ico"><Icon size={17} strokeWidth={2.1} /></span>
          <span className="needs-body">
            <span className="needs-title">{it.title}</span>
            {it.detail && <span className="needs-detail muted">{it.detail}</span>}
          </span>
          <ChevronRight size={16} strokeWidth={2.2} className="needs-chev" />
        </Link>
        {menuBtn(it)}
        {menu(it)}
      </div>
    );
  };

  // ── Spotlight: priority row in full, the rest collapse into a chip strip ──
  const spotlight = () => {
    const [first, ...rest] = data;
    return (
      <>
        <div className="needs-list">{row(first)}</div>
        {rest.length > 0 && (expanded ? (
          <>
            <div className="needs-list">{rest.map(row)}</div>
            <button type="button" className="needs-more" onClick={() => setExpanded(false)}>Show less</button>
          </>
        ) : (
          <button type="button" className="inbox-strip" onClick={() => setExpanded(true)}>
            {rest.map((it) => {
              const Icon = ICON[it.kind];
              return <span key={it.id} className={`inbox-chip sev-${it.severity}`}><Icon size={13} strokeWidth={2.3} />{it.count != null && <b>{it.count}</b>}</span>;
            })}
            <span className="inbox-strip-more">Show all →</span>
          </button>
        ))}
      </>
    );
  };

  // ── Carousel: compact cards, priority first, next peeking; swipe through ──
  const carousel = () => (
    <>
      <div className="inbox-carousel">
        {data.map((it) => {
          const Icon = ICON[it.kind];
          return (
            <div key={it.id} className={`inbox-card sev-${it.severity}`}>
              <Link to={it.link} className="inbox-card-main" onClick={() => act.mutate({ id: it.id, action: "read" })}>
                <span className="needs-ico"><Icon size={18} strokeWidth={2.1} /></span>
                <span className="inbox-card-title">{it.title}</span>
                {it.detail && <span className="inbox-card-detail muted">{it.detail}</span>}
                <span className="inbox-card-go">Open →</span>
              </Link>
              {menuBtn(it)}
              {menu(it)}
            </div>
          );
        })}
      </div>
      <div className="inbox-dots" aria-hidden>{data.map((it) => <span key={it.id} className="inbox-dot" />)}</div>
    </>
  );

  // ── Feed: one priority nudge on the dashboard; the rest behind a sheet ──
  const feed = () => {
    const [first] = data;
    return (
      <>
        <div className="needs-list">{row(first)}</div>
        {data.length > 1 && (
          <button type="button" className="needs-more" onClick={() => setSheetOpen(true)}>View all {data.length} →</button>
        )}
        {sheetOpen && createPortal(
          <div className="inbox-sheet-scrim" onClick={() => setSheetOpen(false)}>
            <div className="inbox-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="inbox-sheet-head">
                <h3>Needs you</h3>
                <button type="button" aria-label="Close" onClick={() => setSheetOpen(false)}><X size={18} /></button>
              </div>
              <div className="needs-list">{data.map(row)}</div>
            </div>
          </div>,
          document.body,
        )}
      </>
    );
  };

  return (
    <div className="flat-list needs-you">
      {head}
      {variant === "carousel" ? carousel() : variant === "feed" ? feed() : spotlight()}
    </div>
  );
}

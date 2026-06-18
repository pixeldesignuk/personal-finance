import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle, Tag, Repeat, PiggyBank, Sparkles, MoreVertical, ChevronRight, Check,
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

// ISO timestamp `days` from now (server validates it's in the future).
const inDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
};

// "Needs you" inbox — the single highest-priority insight in full, the rest
// demoted to a compact chip strip that expands inline. Keeps the dashboard calm
// while still surfacing everything (Mint / Greenlight pattern).
export function NeedsYou() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["insights"], queryFn: () => api.insights() });
  const [menuId, setMenuId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

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

  const head = (
    <div className="flat-head"><div className="flat-head-titles"><h3>Needs you</h3></div></div>
  );

  if (data.length === 0) {
    return (
      <div className="flat-list needs-you">
        {head}
        <p className="needs-clear muted"><Check size={15} strokeWidth={2.4} /> You&rsquo;re all caught up</p>
      </div>
    );
  }

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
        <button type="button" className="needs-menu-btn" aria-label="More" onClick={() => setMenuId(menuId === it.id ? null : it.id)}>
          <MoreVertical size={16} strokeWidth={2.2} />
        </button>
        {menu(it)}
      </div>
    );
  };

  const [first, ...rest] = data;
  return (
    <div className="flat-list needs-you">
      {head}
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
    </div>
  );
}

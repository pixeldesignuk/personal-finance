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

// ISO timestamp `days` from now, formatted from a Date (server validates future).
const inDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
};

export function NeedsYou() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["insights"], queryFn: () => api.insights() });
  const [menuId, setMenuId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const CAP = 4; // keep the inbox compact; items are already priority-sorted

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

  if (data.length === 0) {
    return (
      <div className="flat-list needs-you">
        <div className="flat-head"><div className="flat-head-titles"><h3>Needs you</h3></div></div>
        <p className="needs-clear muted"><Check size={15} strokeWidth={2.4} /> You&rsquo;re all caught up</p>
      </div>
    );
  }

  const shown = expanded ? data : data.slice(0, CAP);
  const hidden = data.length - shown.length;

  return (
    <div className="flat-list needs-you">
      <div className="flat-head"><div className="flat-head-titles"><h3>Needs you</h3></div></div>
      <div className="needs-list">
        {shown.map((it) => {
          const Icon = ICON[it.kind];
          return (
            <div key={it.id} className={`needs-row sev-${it.severity}`}>
              <Link
                to={it.link}
                className="needs-row-main"
                onClick={() => act.mutate({ id: it.id, action: "read" })}
              >
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
              {menuId === it.id && (
                <>
                  <div className="needs-menu-scrim" onClick={() => setMenuId(null)} />
                  <div className="needs-menu" role="menu">
                    <button type="button" onClick={() => act.mutate({ id: it.id, action: "dismiss" })}>Dismiss</button>
                    <button type="button" onClick={() => act.mutate({ id: it.id, action: "snooze", until: inDays(1) })}>Snooze 1 day</button>
                    <button type="button" onClick={() => act.mutate({ id: it.id, action: "snooze", until: inDays(7) })}>Snooze 1 week</button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      {(hidden > 0 || expanded) && (
        <button type="button" className="needs-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show less" : `Show ${hidden} more`}
        </button>
      )}
    </div>
  );
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, Tag, Repeat, PiggyBank, Sparkles, X } from "lucide-react";
import { api } from "../api.ts";
import type { InsightDTO, InsightKind } from "../../../shared/types.ts";

const ICON: Record<InsightKind, typeof Tag> = {
  overspent: AlertTriangle,
  needs_category: Tag,
  new_subscription: Repeat,
  surplus: PiggyBank,
  new_transactions: Sparkles,
};

// Notification-style command-center inbox: no section title, the top-priority
// item shown as a dismissible card, the rest behind a subtle "N more" expander.
// Tapping a card navigates (and marks read); the inline × dismisses it.
export function NeedsYou() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["insights"], queryFn: () => api.insights() });
  const [expanded, setExpanded] = useState(false);

  const dismiss = useMutation({
    mutationFn: (id: string) => api.patchInsight(id, "dismiss"),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["insights"] });
      const prev = qc.getQueryData<InsightDTO[]>(["insights"]);
      qc.setQueryData<InsightDTO[]>(["insights"], (old) => (old ?? []).filter((i) => i.id !== id));
      return { prev };
    },
    onError: (_e, _id, ctx) => { if (ctx?.prev) qc.setQueryData(["insights"], ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["insights"] }),
  });
  const read = useMutation({
    mutationFn: (id: string) => api.patchInsight(id, "read"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["insights"] }),
  });

  if (!data || data.length === 0) return null;

  const shown = expanded ? data : data.slice(0, 1);
  const hidden = data.length - shown.length;

  return (
    <div className="needs-you">
      <div className="needs-list">
        {shown.map((it) => {
          const Icon = ICON[it.kind];
          return (
            <div key={it.id} className={`needs-row sev-${it.severity}`}>
              <Link to={it.link} className="needs-row-main" onClick={() => read.mutate(it.id)}>
                <span className="needs-ico"><Icon size={16} strokeWidth={2.1} /></span>
                <span className="needs-body">
                  <span className="needs-title">{it.title}</span>
                  {it.detail && <span className="needs-detail muted">{it.detail}</span>}
                </span>
              </Link>
              <button type="button" className="needs-dismiss" aria-label="Dismiss" onClick={() => dismiss.mutate(it.id)}>
                <X size={15} strokeWidth={2.4} />
              </button>
            </div>
          );
        })}
      </div>
      {(hidden > 0 || expanded) && (
        <button type="button" className="needs-expand" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show less" : `${hidden} more notification${hidden === 1 ? "" : "s"}`}
        </button>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.ts";
import type { SettingsDTO } from "../../../shared/types.ts";

export function SettingsDrawer() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: () => api.settings(), enabled: open });

  const mut = useMutation({
    mutationFn: (patch: Record<string, boolean>) => api.patchSettings(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ["settings"] });
      const prev = qc.getQueryData<SettingsDTO>(["settings"]);
      if (prev) qc.setQueryData<SettingsDTO>(["settings"], { ...prev, values: { ...prev.values, ...patch } });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["settings"], ctx.prev); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ["settings"] }); qc.invalidateQueries({ queryKey: ["summary"] }); },
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const groups = data ? [...new Set(data.defs.map((d) => d.group))] : [];

  return (
    <>
      <button className="cog-btn" onClick={() => setOpen(true)} title="Settings" aria-label="Settings">⚙</button>
      {open && createPortal(
        <div className="drawer-backdrop" onClick={() => setOpen(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <span className="sheet-title">Settings</span>
              <button className="btn-sm" onClick={() => setOpen(false)}>Close</button>
            </div>
            <div className="drawer-body">
              <div className="drawer-section">
                <div className="eyebrow">Navigation</div>
                <NavLink to="/plugins" className="drawer-link" onClick={() => setOpen(false)}>Plugins</NavLink>
                <NavLink to="/people" className="drawer-link" onClick={() => setOpen(false)}>People</NavLink>
              </div>
              {!data && <div className="drawer-section muted">Loading…</div>}
              {groups.map((g) => (
                <div className="drawer-section" key={g}>
                  <div className="eyebrow">{g}</div>
                  {data!.defs.filter((d) => d.group === g).map((d) => (
                    <label className="setting-row" key={d.key}>
                      <span>{d.label}</span>
                      <span className="switch">
                        <input type="checkbox" checked={data!.values[d.key] ?? d.default} onChange={(e) => mut.mutate({ [d.key]: e.target.checked })} />
                        <span className="slider" />
                      </span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </aside>
        </div>,
        document.body,
      )}
    </>
  );
}

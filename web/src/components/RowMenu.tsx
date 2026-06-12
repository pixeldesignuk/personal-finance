import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreVertical } from "lucide-react";

// A vertical-kebab (⋮) context menu for a table row. The popover is portalled to
// the body and positioned via the trigger's rect, so the table's horizontal
// scroll/overflow can't clip it. Children are the menu body (buttons).
export function RowMenu({ children, label = "Actions" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    setPos({ left: Math.max(8, r.right - 184), top: r.bottom + 4 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <>
      <button ref={btn} type="button" className="btn-sm rowmenu-btn" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <MoreVertical size={15} strokeWidth={2} />
      </button>
      {open && createPortal(
        <div ref={pop} className="card-menu-pop rowmenu-pop" style={{ left: pos.left, top: pos.top }} onClick={() => setOpen(false)}>
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}

import { useEffect, useRef, useState, type ReactNode } from "react";

// A small kebab (⋯) menu anchored to a card corner. Children are the menu body
// (buttons / rows). Clicking inside closes it; so does outside-click / Esc.
export function CardMenu({ children, label = "Actions" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div className="card-menu" ref={ref}>
      <button type="button" className="card-menu-btn" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>⋯</button>
      {open && <div className="card-menu-pop" onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

export interface NavItem { to: string; label: string; end?: boolean }

// A top-nav dropdown: hover or click to open, lists child routes. Highlights the
// trigger when any child route is active. Reuses the `.cog-menu` popover styling.
export function NavMenu({ label, items }: { label: string; items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const active = items.some((i) => (i.end ? pathname === i.to : pathname.startsWith(i.to)));

  useEffect(() => { setOpen(false); }, [pathname]); // close on navigation
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="nav-group" ref={ref} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className={`nav-group-trigger${active ? " active" : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}<span className="nav-caret" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="cog-menu nav-menu">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} onClick={() => setOpen(false)}>{i.label}</NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

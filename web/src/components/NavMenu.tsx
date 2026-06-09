import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

export interface NavItem { to: string; label: string; end?: boolean }

// Top-nav dropdown: opens on hover, closes on leave (short grace delay bridges
// the trigger→menu gap). When `to` is set the parent is itself a navigable link
// (Budget → /budgets); otherwise it's a plain toggle (Wealth). The submenu items
// are ordinary links so they're always directly clickable.
export function NavMenu({ label, to, items }: { label: string; to?: string; items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { pathname } = useLocation();
  const childActive = items.some((i) => (i.end ? pathname === i.to : pathname.startsWith(i.to)));
  const active = childActive || (to ? pathname === to || pathname.startsWith(to) : false);

  const cancel = () => { if (timer.current) clearTimeout(timer.current); };
  const show = () => { cancel(); setOpen(true); };
  const hideSoon = () => { cancel(); timer.current = setTimeout(() => setOpen(false), 140); };

  useEffect(() => { setOpen(false); }, [pathname]); // close after navigating
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  useEffect(() => () => cancel(), []);

  const caret = <span className="nav-caret" aria-hidden>▾</span>;
  const cls = `nav-group-trigger${active ? " active" : ""}`;

  return (
    <div className="nav-group" ref={ref} onMouseEnter={show} onMouseLeave={hideSoon}>
      {to
        ? <NavLink to={to} end className={cls} aria-expanded={open} onClick={() => setOpen(false)}>{label}{caret}</NavLink>
        : <button type="button" className={cls} aria-expanded={open} onClick={() => setOpen((o) => !o)}>{label}{caret}</button>}
      {open && (
        <div className="nav-menu" role="menu" onMouseEnter={show} onMouseLeave={hideSoon}>
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} role="menuitem" onClick={() => setOpen(false)}>{i.label}</NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

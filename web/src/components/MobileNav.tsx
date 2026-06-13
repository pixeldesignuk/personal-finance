import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation } from "react-router-dom";

const GROUPS: { title: string; items: { to: string; label: string; end?: boolean }[] }[] = [
  { title: "", items: [
    { to: "/", label: "Dashboard", end: true }, { to: "/transactions", label: "Transactions" },
  ] },
  { title: "Spending", items: [
    { to: "/budgets", label: "Budget" }, { to: "/recurring", label: "Bills" },
    { to: "/reports", label: "Reports" },
  ] },
  { title: "Accounts", items: [
    { to: "/accounts", label: "Accounts" }, { to: "/investments", label: "Investments" },
    { to: "/savings", label: "Savings" }, { to: "/assets", label: "Assets" },
    { to: "/debts", label: "Debts" },
  ] },
  { title: "Manage", items: [
    { to: "/merchants", label: "Merchants" }, { to: "/orders", label: "Receipts" },
    { to: "/people", label: "People" }, { to: "/plugins", label: "Plugins" },
  ] },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      <button className="nav-mobile-btn" aria-label="Menu" onClick={() => setOpen(true)}>☰</button>
      {open && createPortal(
        <div className="mnav-backdrop" onClick={() => setOpen(false)}>
          <aside className="mnav" onClick={(e) => e.stopPropagation()}>
            <div className="mnav-head">
              <span className="wordmark">Led<b>·</b>ger</span>
              <button className="btn-sm" onClick={() => setOpen(false)}>Close</button>
            </div>
            <div className="mnav-body">
              {GROUPS.map((g, i) => (
                <div className="mnav-group" key={i}>
                  {g.title && <div className="eyebrow">{g.title}</div>}
                  {g.items.map((it) => (
                    <NavLink key={it.to} to={it.to} end={it.end} className="mnav-link" onClick={() => setOpen(false)}>{it.label}</NavLink>
                  ))}
                </div>
              ))}
              <NavLink to="/connect" className="btn-primary mnav-cta" onClick={() => setOpen(false)}>Connect a bank</NavLink>
            </div>
          </aside>
        </div>,
        document.body,
      )}
    </>
  );
}

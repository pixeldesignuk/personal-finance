import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, ArrowLeftRight, PieChart, PiggyBank, Menu } from "lucide-react";
import { SettingsDrawer } from "./SettingsDrawer.tsx";

// Main destinations pinned to the floating bar; everything else lives in "More".
const TABS = [
  { to: "/", label: "Home", icon: LayoutDashboard, end: true },
  { to: "/transactions", label: "Activity", icon: ArrowLeftRight },
  { to: "/budgets", label: "Budget", icon: PieChart },
  { to: "/savings", label: "Savings", icon: PiggyBank },
];

// The full menu, surfaced from the "More" tab.
const MORE: { title: string; items: { to: string; label: string }[] }[] = [
  { title: "Spending", items: [
    { to: "/budgets", label: "Budget" }, { to: "/recurring", label: "Bills" }, { to: "/reports", label: "Reports" },
  ] },
  { title: "Accounts", items: [
    { to: "/accounts", label: "Accounts" }, { to: "/investments", label: "Investments" },
    { to: "/savings", label: "Savings" }, { to: "/assets", label: "Assets" }, { to: "/debts", label: "Debts" },
  ] },
  { title: "Manage", items: [
    { to: "/merchants", label: "Merchants" }, { to: "/orders", label: "Receipts" },
    { to: "/people", label: "People" }, { to: "/plugins", label: "Plugins" },
  ] },
];

// Mobile-only floating bottom navigation (hidden on desktop via CSS). The top
// header is hidden on mobile, so the "More" sheet also carries Settings + Connect.
export function MobileTabBar() {
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
      <nav className="mobile-tabbar" aria-label="Primary">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className="mtab">
            <t.icon size={21} strokeWidth={2} />
            <span>{t.label}</span>
          </NavLink>
        ))}
        <button className="mtab" type="button" onClick={() => setOpen(true)} aria-label="More">
          <Menu size={21} strokeWidth={2} />
          <span>More</span>
        </button>
      </nav>

      {open && createPortal(
        <div className="mnav-backdrop" onClick={() => setOpen(false)}>
          <aside className="mnav" onClick={(e) => e.stopPropagation()}>
            <div className="mnav-head">
              <span className="wordmark">Led<b>·</b>ger</span>
              <div className="mnav-head-actions">
                <SettingsDrawer />
                <button className="btn-sm" onClick={() => setOpen(false)}>Close</button>
              </div>
            </div>
            <div className="mnav-body">
              {MORE.map((g, i) => (
                <div className="mnav-group" key={i}>
                  <div className="eyebrow">{g.title}</div>
                  {g.items.map((it) => (
                    <NavLink key={it.to} to={it.to} className="mnav-link" onClick={() => setOpen(false)}>{it.label}</NavLink>
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

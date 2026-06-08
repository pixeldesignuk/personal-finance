import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import Connect from "./pages/Connect.tsx";
import Callback from "./pages/Callback.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import Transactions from "./pages/Transactions.tsx";
import Accounts from "./pages/Accounts.tsx";
import Budgets from "./pages/Budgets.tsx";
import Reports from "./pages/Reports.tsx";
import Investments from "./pages/Investments.tsx";
import People from "./pages/People.tsx";
import Rules from "./pages/Rules.tsx";

function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);
  return (
    <div className="cog" ref={ref}>
      <button className="cog-btn" onClick={() => setOpen((v) => !v)} title="Settings" aria-label="Settings">⚙</button>
      {open && (
        <div className="cog-menu" onClick={() => setOpen(false)}>
          <NavLink to="/people">People</NavLink>
          <NavLink to="/rules">Rules</NavLink>
          <NavLink to="/accounts">Manage accounts</NavLink>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <>
      <nav>
        <Link to="/" className="wordmark">Led<b>·</b>ger</Link>
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/transactions">Transactions</NavLink>
        <NavLink to="/budgets">Budget</NavLink>
        <NavLink to="/reports">Reports</NavLink>
        <NavLink to="/investments">Investments</NavLink>
        <SettingsMenu />
        <NavLink to="/connect" className="btn-primary nav-cta">Connect</NavLink>
      </nav>
      <div className="container">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/budgets" element={<Budgets />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/investments" element={<Investments />} />
          <Route path="/people" element={<People />} />
          <Route path="/rules" element={<Rules />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/connect" element={<Connect />} />
          <Route path="/callback" element={<Callback />} />
        </Routes>
      </div>
    </>
  );
}

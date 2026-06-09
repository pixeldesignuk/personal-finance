import { Link, NavLink, Route, Routes } from "react-router-dom";
import Connect from "./pages/Connect.tsx";
import Callback from "./pages/Callback.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import Transactions from "./pages/Transactions.tsx";
import Accounts from "./pages/Accounts.tsx";
import Budgets from "./pages/Budgets.tsx";
import Reports from "./pages/Reports.tsx";
import Investments from "./pages/Investments.tsx";
import Debts from "./pages/Debts.tsx";
import Merchants from "./pages/Merchants.tsx";
import People from "./pages/People.tsx";
import { NavMenu } from "./components/NavMenu.tsx";
import { SettingsDrawer } from "./components/SettingsDrawer.tsx";

export default function App() {
  return (
    <>
      <nav>
        <Link to="/" className="wordmark">Led<b>·</b>ger</Link>
        <NavLink to="/" end>Dashboard</NavLink>
        <NavMenu label="Budget" items={[
          { to: "/budgets", label: "Budget" },
          { to: "/transactions", label: "Transactions" },
          { to: "/reports", label: "Reports" },
          { to: "/merchants", label: "Merchants" },
        ]} />
        <NavMenu label="Wealth" items={[
          { to: "/investments", label: "Investments" },
          { to: "/debts", label: "Debts" },
        ]} />
        <SettingsDrawer />
        <NavLink to="/connect" className="btn-primary nav-cta">Connect</NavLink>
      </nav>
      <div className="container">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/budgets" element={<Budgets />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/investments" element={<Investments />} />
          <Route path="/debts" element={<Debts />} />
          <Route path="/merchants" element={<Merchants />} />
          {/* Rules are managed per-merchant on the Merchants page */}
          <Route path="/people" element={<People />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/connect" element={<Connect />} />
          <Route path="/callback" element={<Callback />} />
        </Routes>
      </div>
    </>
  );
}

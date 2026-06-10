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
import Savings from "./pages/Savings.tsx";
import Assets from "./pages/Assets.tsx";
import Plugins from "./pages/Plugins.tsx";
import Orders from "./pages/Orders.tsx";
import Merchants from "./pages/Merchants.tsx";
import People from "./pages/People.tsx";
import { NavMenu } from "./components/NavMenu.tsx";
import { SettingsDrawer } from "./components/SettingsDrawer.tsx";
import { MobileNav } from "./components/MobileNav.tsx";

export default function App() {
  return (
    <>
      <nav>
        <Link to="/" className="wordmark">Led<b>·</b>ger</Link>
        <div className="nav-right">
          <NavLink to="/" end>Dashboard</NavLink>
          <NavMenu label="Budget" to="/budgets" items={[
            { to: "/transactions", label: "Transactions" },
            { to: "/reports", label: "Reports" },
            { to: "/merchants", label: "Merchants" },
            { to: "/orders", label: "Orders" },
            { to: "/accounts", label: "Accounts" },
          ]} />
          <NavMenu label="Wealth" items={[
            { to: "/investments", label: "Investments" },
            { to: "/savings", label: "Savings" },
            { to: "/assets", label: "Assets" },
            { to: "/debts", label: "Debts" },
          ]} />
          <SettingsDrawer />
          <NavLink to="/connect" className="btn-primary nav-cta">Connect</NavLink>
        </div>
        <MobileNav />
      </nav>
      <div className="container">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/budgets" element={<Budgets />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/investments" element={<Investments />} />
          <Route path="/debts" element={<Debts />} />
          <Route path="/savings" element={<Savings />} />
          <Route path="/assets" element={<Assets />} />
          <Route path="/plugins" element={<Plugins />} />
          <Route path="/orders" element={<Orders />} />
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

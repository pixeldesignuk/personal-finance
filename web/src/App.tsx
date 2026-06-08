import { Link, NavLink, Route, Routes } from "react-router-dom";
import Connect from "./pages/Connect.tsx";
import Callback from "./pages/Callback.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import Transactions from "./pages/Transactions.tsx";
import Accounts from "./pages/Accounts.tsx";
import Budgets from "./pages/Budgets.tsx";
import Categories from "./pages/Categories.tsx";
import People from "./pages/People.tsx";
import Rules from "./pages/Rules.tsx";

export default function App() {
  return (
    <>
      <nav>
        <Link to="/" className="wordmark">Led<b>·</b>ger</Link>
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/transactions">Transactions</NavLink>
        <NavLink to="/budgets">Budgets</NavLink>
        <NavLink to="/categories">Categories</NavLink>
        <NavLink to="/people">People</NavLink>
        <NavLink to="/rules">Rules</NavLink>
        <NavLink to="/accounts">Manage</NavLink>
        <NavLink to="/connect">Connect</NavLink>
      </nav>
      <div className="container">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/budgets" element={<Budgets />} />
          <Route path="/categories" element={<Categories />} />
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

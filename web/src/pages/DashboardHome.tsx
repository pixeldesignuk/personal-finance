import { useState } from "react";
import Dashboard from "./Dashboard.tsx";
import { AccountsStrip } from "../components/AccountsStrip.tsx";

// The primary dashboard: the dashboard body with a swipeable account strip pinned
// to the top (net worth + per-account balances). The Customize toggle is hoisted
// here so it can sit in the strip header while still driving the dashboard's
// drag-to-reorder edit mode. (The plain body alone is the legacy view at /v1.)
export default function DashboardHome() {
  const [editing, setEditing] = useState(false);
  return (
    <div className="dash-home">
      <AccountsStrip editing={editing} onToggleEditing={() => setEditing((e) => !e)} />
      <Dashboard minimal editing={editing} onEditingChange={setEditing} />
    </div>
  );
}

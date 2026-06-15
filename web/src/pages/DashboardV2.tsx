import { useState } from "react";
import Dashboard from "./Dashboard.tsx";
import { AccountsStrip } from "../components/AccountsStrip.tsx";

// Dashboard v2 — the existing dashboard with a swipeable account strip pinned to
// the top (net worth + per-account balances). Lives behind /v2 so the original
// dashboard stays untouched while the layout is trialled. The Customize toggle is
// hoisted here so it can sit in the strip header while still driving the
// dashboard's drag-to-reorder edit mode.
export default function DashboardV2() {
  const [editing, setEditing] = useState(false);
  return (
    <div className="dash-v2">
      <AccountsStrip editing={editing} onToggleEditing={() => setEditing((e) => !e)} />
      <Dashboard minimal editing={editing} onEditingChange={setEditing} />
    </div>
  );
}

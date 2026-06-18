import { useState } from "react";
import Dashboard from "./Dashboard.tsx";
import { AccountsStrip } from "../components/AccountsStrip.tsx";
import { PlanProgressCard } from "../components/PlanProgressCard.tsx";
import { NeedsYou } from "../components/NeedsYou.tsx";

// The primary dashboard: account strip on top, then the two command-center cards
// (plan progress + needs-you inbox), then the dashboard body. The Customize
// toggle is hoisted here so it can sit in the strip header.
export default function DashboardHome() {
  const [editing, setEditing] = useState(false);
  return (
    <div className="dash-home">
      <AccountsStrip editing={editing} onToggleEditing={() => setEditing((e) => !e)} />
      <PlanProgressCard />
      <NeedsYou />
      <Dashboard minimal editing={editing} onEditingChange={setEditing} />
    </div>
  );
}

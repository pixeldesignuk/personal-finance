// web/src/components/SurplusNudge.tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { PiggyBank } from "lucide-react";
import { api } from "../api.ts";
import { formatGBP } from "../format.ts";

export function SurplusNudge() {
  const { data } = useQuery({ queryKey: ["plan"], queryFn: () => api.plan() });
  if (!data || data.surplus <= 0 || !data.current) return null;
  const step = data.steps.find((s) => s.key === data.current);
  const hint = step?.actionHint;
  if (!hint) return null;
  return (
    <Link to="/savings" className="card surplus-nudge">
      <span className="surplus-ico"><PiggyBank size={20} strokeWidth={2} /></span>
      <span className="surplus-body">
        <span className="surplus-amt num">{formatGBP(data.surplus)} spare</span>
        <span className="surplus-hint muted">{hint}</span>
      </span>
      <span className="surplus-go">Review →</span>
    </Link>
  );
}

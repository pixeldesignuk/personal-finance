import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import type { LucideIcon } from "lucide-react";
import { formatGBP } from "../../format.ts";

export interface FanSegment { key: string; name: string; value: number; color: string; Icon: LucideIcon }

const RADIAN = Math.PI / 180;

// A semicircular "fan" of category segments sized by spend (Dollar Wise style),
// built on Recharts' Pie — rounded, padded segments via cornerRadius/paddingAngle.
// An icon sits at each large segment's mid-angle; the centre shows spent-of-budget.
export function BudgetFan({ segments, spent, budgeted, onSelect }: { segments: FanSegment[]; spent: number; budgeted: number; onSelect?: (key: string) => void }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  // The lumped "Other" segment isn't a real category, so it's not selectable.
  const select = (index: number) => { const seg = segments[index]; if (onSelect && seg && seg.key !== "__other") onSelect(seg.key); };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderIcon = (props: any) => {
    const { cx, cy, midAngle, innerRadius, outerRadius, index } = props;
    const seg = segments[index];
    if (!seg || seg.value / total < 0.032) return null; // skip only slivers too thin for an icon
    const r = (innerRadius + outerRadius) / 2;
    const x = cx + r * Math.cos(-midAngle * RADIAN);
    const y = cy + r * Math.sin(-midAngle * RADIAN);
    const Icon = seg.Icon;
    return (
      <g transform={`translate(${x - 7} ${y - 7})`} style={{ pointerEvents: "none" }}>
        <Icon size={14} strokeWidth={2.2} color="#0c0d0e" />
      </g>
    );
  };

  return (
    <div className="v2-fan">
      <div className="v2-fan-chart">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <Pie
              data={segments}
              dataKey="value"
              startAngle={180}
              endAngle={0}
              cx="50%"
              cy="50%"
              innerRadius="68%"
              outerRadius="100%"
              cornerRadius={8}
              paddingAngle={2.5}
              stroke="none"
              isAnimationActive={false}
              labelLine={false}
              label={renderIcon}
              onClick={(_, index) => select(index)}
            >
              {segments.map((s) => <Cell key={s.key} fill={s.color} style={{ cursor: onSelect && s.key !== "__other" ? "pointer" : "default" }} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="v2-fan-center">
        <span className="v2-fan-label">Spent</span>
        <span className="v2-fan-figure num">{formatGBP(spent)}</span>
        <span className="v2-fan-sub">of {formatGBP(budgeted)} budget</span>
      </div>
    </div>
  );
}

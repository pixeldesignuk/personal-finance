import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import type { CategoryTotal } from "../../../../shared/types.ts";
import { formatGBP } from "../../format.ts";

const COLORS = ["#6FE3B0", "#E2C08D", "#FF7E6B", "#F2B14C", "#7FB2FF", "#C79BFF", "#7e7c74"];

const TOOLTIP = {
  background: "#1e2125",
  border: "1px solid rgba(233,230,223,0.16)",
  borderRadius: 10,
  color: "#E9E6DF",
  fontSize: 13,
};

export function CategoryPie({ data }: { data: CategoryTotal[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey="total" nameKey="category" innerRadius={52} outerRadius={92} paddingAngle={2} stroke="none" label={{ fill: "#b4b2a9", fontSize: 12 }}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip contentStyle={TOOLTIP} itemStyle={{ color: "#E9E6DF" }} formatter={(v) => formatGBP(v as number)} />
      </PieChart>
    </ResponsiveContainer>
  );
}

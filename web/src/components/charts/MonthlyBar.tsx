import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from "recharts";
import type { MonthlyTotal } from "../../../../shared/types.ts";
import { formatGBP } from "../../format.ts";

const TICK = { fill: "#7e7c74", fontSize: 12 };
const TOOLTIP = {
  background: "#1e2125",
  border: "1px solid rgba(233,230,223,0.16)",
  borderRadius: 10,
  color: "#E9E6DF",
  fontSize: 13,
};

export function MonthlyBar({ data }: { data: MonthlyTotal[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} barGap={4}>
        <CartesianGrid vertical={false} stroke="rgba(233,230,223,0.07)" />
        <XAxis dataKey="month" tick={TICK} axisLine={{ stroke: "rgba(233,230,223,0.12)" }} tickLine={false} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} width={44} />
        <Tooltip cursor={{ fill: "rgba(233,230,223,0.05)" }} contentStyle={TOOLTIP} itemStyle={{ color: "#E9E6DF" }} formatter={(v) => formatGBP(v as number)} />
        <Legend wrapperStyle={{ fontSize: 12, color: "#b4b2a9" }} />
        <Bar dataKey="spent" name="Spent" fill="#FF7E6B" radius={[4, 4, 0, 0]} />
        <Bar dataKey="received" name="Received" fill="#6FE3B0" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

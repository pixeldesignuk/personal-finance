import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { MonthlyTotal } from "../../../../shared/types.ts";

export function MonthlyBar({ data }: { data: MonthlyTotal[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data}>
        <XAxis dataKey="month" /><YAxis /><Tooltip /><Legend />
        <Bar dataKey="spent" fill="#dc2626" />
        <Bar dataKey="received" fill="#16a34a" />
      </BarChart>
    </ResponsiveContainer>
  );
}

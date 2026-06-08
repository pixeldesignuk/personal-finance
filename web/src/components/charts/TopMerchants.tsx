import type { MerchantTotal } from "../../../../shared/types.ts";
import { formatMoney } from "../../format.ts";

export function TopMerchants({ data }: { data: MerchantTotal[] }) {
  return (
    <table>
      <thead><tr><th>Merchant</th><th>Spent</th><th>#</th></tr></thead>
      <tbody>
        {data.map((m) => (
          <tr key={m.merchant}><td>{m.merchant}</td><td>£{formatMoney(m.total)}</td><td>{m.count}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

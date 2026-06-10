import type { MerchantTotal } from "../../../../shared/types.ts";
import { BarList } from "../BarList.tsx";
import { BrandLogo } from "../BrandLogo.tsx";
import { merchantLogo } from "../../brand.ts";

export function TopMerchants({ data }: { data: MerchantTotal[] }) {
  return (
    <BarList
      items={data.slice(0, 8).map((m) => ({
        key: m.merchant,
        label: m.merchant,
        value: m.total,
        sub: `${m.count}×`,
        leading: <BrandLogo name={m.merchant} src={merchantLogo(m.merchant, null)} size={22} />,
      }))}
    />
  );
}

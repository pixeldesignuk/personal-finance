import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.ts";
import type { BankDTO } from "../../../shared/types.ts";

export function AccountSelector() {
  const [banks, setBanks] = useState<BankDTO[]>([]);
  const [params, setParams] = useSearchParams();
  const selected = params.get("account") ?? "all";

  useEffect(() => {
    api.accounts().then(setBanks).catch(() => setBanks([]));
  }, []);

  const onChange = (value: string) => {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete("account");
    else next.set("account", value);
    setParams(next, { replace: true });
  };

  return (
    <select className="account-select" value={selected} onChange={(e) => onChange(e.target.value)}>
      <option value="all">All accounts</option>
      {banks.flatMap((bank) =>
        bank.accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {bank.institutionName} — {a.displayName}
          </option>
        )),
      )}
    </select>
  );
}

import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LayoutGrid, Plus, TrendingUp, Wallet } from "lucide-react";
import { api } from "../api.ts";
import { formatCcy, formatGBP } from "../format.ts";
import { BrandLogo } from "./BrandLogo.tsx";
import { HealthRing } from "./HealthRing.tsx";
import { AccountHealthPanel } from "./AccountHealthPanel.tsx";

// A horizontal, swipeable strip of account "chips" pinned to the top of the v2
// dashboard — net worth as the lead chip, then one chip per bank/cash account,
// then an "Add" affordance. Tapping a chip filters the dashboard to that account
// (via ?account=); the net-worth chip clears the filter. Mirrors the Accounts
// page's notion of a top-level account (banks + cash; investments, assets and
// debts have their own spaces).
export function AccountsStrip({ editing, onToggleEditing }: { editing?: boolean; onToggleEditing?: () => void }) {
  const [params] = useSearchParams();
  const activeId = params.get("account");
  const month = params.get("month");

  const { data: summary } = useQuery({ queryKey: ["summary"], queryFn: () => api.summary() });
  const { data: banks } = useQuery({ queryKey: ["accounts"], queryFn: () => api.accounts() });
  const { data: health } = useQuery({ queryKey: ["accounts-health"], queryFn: () => api.accountsHealth() });
  const healthByAcct = useMemo(
    () => new Map((health ?? []).map((h) => [h.accountId, h])),
    [health],
  );
  const [openId, setOpenId] = useState<string | null>(null);

  const accounts = useMemo(
    () =>
      (banks ?? [])
        .filter((b) => !["INVESTMENT", "ASSET", "LIABILITY"].includes(b.status))
        .flatMap((bank) => bank.accounts.map((a) => ({ bank, a })))
        // Biggest balance by magnitude first — a sizeable credit-card debt is more
        // relevant than a near-zero account, so rank on |balance|, not signed value.
        .sort((x, y) => Math.abs(y.a.currentBalance) - Math.abs(x.a.currentBalance)),
    [banks],
  );

  // Preserve the selected month when navigating between chips.
  const to = (accountId?: string) => {
    const q = new URLSearchParams();
    if (month) q.set("month", month);
    if (accountId) q.set("account", accountId);
    const s = q.toString();
    return s ? `?${s}` : "";
  };

  if (!banks) return null;

  return (
    <div className="acct-strip-wrap">
      <div className="acct-strip-head">
        <h3>Accounts</h3>
        {onToggleEditing && (
          <button
            className={`strip-icon-btn${editing ? " active" : ""}`}
            title={editing ? "Done customising" : "Customize layout"}
            aria-pressed={editing}
            onClick={onToggleEditing}
          >
            <LayoutGrid size={17} strokeWidth={2} />
          </button>
        )}
      </div>
      <div className="acct-strip" role="list">
      <Link to={to()} className={`acct-chip net${!activeId ? " active" : ""}`} role="listitem">
        <span className="acct-chip-ico net"><TrendingUp size={20} strokeWidth={2.2} /></span>
        <span className="acct-chip-val num">{formatGBP(summary?.netWorth ?? 0)}</span>
        <span className="acct-chip-name">Net worth</span>
      </Link>

      {accounts.map(({ bank, a }) => {
        const isCash = a.source === "MANUAL";
        const name = isCash ? a.displayName : bank.institutionName;
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => setOpenId(a.id)}
            className={`acct-chip${activeId === a.id ? " active" : ""}`}
            role="listitem"
          >
            <span className="acct-chip-ico">
              {isCash
                ? <span className="acct-chip-cash"><Wallet size={18} strokeWidth={2} /></span>
                : <BrandLogo name={bank.institutionName} src={bank.institutionLogo} size={44} />}
              <HealthRing health={healthByAcct.get(a.id)} />
            </span>
            <span className={`acct-chip-val num${a.currentBalance < 0 ? " neg" : ""}`}>{formatCcy(a.currentBalance, a.currency)}</span>
            <span className="acct-chip-name" title={name}>{name}</span>
          </button>
        );
      })}

      <Link to="/connect" className="acct-chip add" role="listitem">
        <span className="acct-chip-ico add"><Plus size={20} strokeWidth={2.4} /></span>
        <span className="acct-chip-name">Add account</span>
      </Link>
      </div>
      {openId && healthByAcct.get(openId) && (() => {
        const found = accounts.find(({ a }) => a.id === openId);
        const acct = found?.a;
        const label = acct ? (acct.source === "MANUAL" ? acct.displayName : found!.bank.institutionName) : "";
        return (
          <AccountHealthPanel
            name={label}
            health={healthByAcct.get(openId)!}
            viewTxnsTo={`/transactions${to(openId)}`}
            onClose={() => setOpenId(null)}
          />
        );
      })()}
    </div>
  );
}

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.ts";
import type { MerchantDTO } from "../../../shared/types.ts";
import { formatGBP, formatMoney, relativeDate } from "../format.ts";

const TABS: [string, string][] = [["all", "All"], ["fixed", "Recurring"], ["variable", "Variable"]];
const TYPE_LABEL: Record<string, string> = { fixed: "Recurring", variable: "Variable", oneoff: "One-off", ignore: "Ignored" };

export default function Merchants() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["merchants"], queryFn: () => api.merchants() });
  const catNamesQuery = useQuery({ queryKey: ["categoryNames"], queryFn: () => api.categoryNames(), staleTime: 5 * 60_000 });
  const catNames = catNamesQuery.data ?? [];
  const [tab, setTab] = useState("all");

  const [nameEdit, setNameEdit] = useState<{ token: string; value: string } | null>(null);
  const setName = useMutation({
    mutationFn: ({ token, name }: { token: string; name: string }) => api.patchMerchant(token, { name }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["merchants"] }),
  });
  const saveName = () => { if (nameEdit) { setName.mutate({ token: nameEdit.token, name: nameEdit.value.trim() }); setNameEdit(null); } };

  const setCat = useMutation({
    mutationFn: ({ token, categoryKey }: { token: string; categoryKey: string }) => api.patchMerchant(token, { categoryKey }),
    onMutate: async ({ token, categoryKey }) => {
      await qc.cancelQueries({ queryKey: ["merchants"] });
      const prev = qc.getQueryData(["merchants"]);
      qc.setQueryData(["merchants"], (old: typeof data) => old ? { ...old, merchants: old.merchants.map((m) => m.token === token ? { ...m, categoryKey } : m) } : old);
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["merchants"], ctx.prev); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ["merchants"] }); },
  });

  const setType = useMutation({
    mutationFn: ({ token, recurring }: { token: string; recurring: MerchantDTO["override"] }) => api.patchMerchant(token, { recurring }),
    onMutate: async ({ token, recurring }) => {
      await qc.cancelQueries({ queryKey: ["merchants"] });
      const prev = qc.getQueryData(["merchants"]);
      qc.setQueryData(["merchants"], (old: typeof data) => old ? { ...old, merchants: old.merchants.map((m) => m.token === token ? { ...m, override: recurring, effective: recurring === "auto" ? m.detected : recurring } : m) } : old);
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["merchants"], ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["merchants"] }),
  });

  const shown = useMemo(() => (data?.merchants ?? []).filter((m) => tab === "all" || m.effective === tab), [data, tab]);

  return (
    <div>
      <h1>Merchants</h1>
      {data && (
        <div className="grid">
          <div className="card stat"><span className="label">Monthly outgoings</span><span className="value">{formatGBP(data.monthlyOutgoings)}</span><span className="delta muted">committed / recurring</span></div>
          <div className="card stat"><span className="label">Variable / month</span><span className="value">{formatGBP(data.variableMonthly)}</span><span className="delta muted">avg flexible spend</span></div>
          <div className="card stat"><span className="label">Merchants</span><span className="value">{data.merchants.length}</span></div>
        </div>
      )}

      <div className="tabs">
        {TABS.map(([k, l]) => <button key={k} className={`tab${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      <div className="card">
        <table className="txn-table">
          <colgroup><col /><col style={{ width: 160 }} /><col style={{ width: 110 }} /><col style={{ width: 110 }} /><col style={{ width: 70 }} /><col style={{ width: 100 }} /><col style={{ width: 190 }} /></colgroup>
          <thead><tr><th>Merchant</th><th>Category</th><th style={{ textAlign: "right" }}>Per month</th><th style={{ textAlign: "right" }}>Total</th><th style={{ textAlign: "right" }}>Txns</th><th>Last</th><th>Type</th></tr></thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.token}>
                <td>
                  {nameEdit?.token === m.token ? (
                    <input className="note-input" autoFocus placeholder="Human-readable name" value={nameEdit.value}
                      onChange={(e) => setNameEdit({ token: m.token, value: e.target.value })}
                      onBlur={saveName}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setNameEdit(null); }} />
                  ) : (
                    <div className="td-clip">
                      {m.name
                        ? <Link className="amount-link" to={`/transactions?merchant=${encodeURIComponent(m.token)}`}>{m.name}</Link>
                        : <Link className="amount-link muted" to={`/transactions?merchant=${encodeURIComponent(m.token)}`} style={{ fontStyle: "italic" }}>Unnamed</Link>}
                      <button className="btn-sm" style={{ marginLeft: 6, padding: "1px 6px" }} title={m.name ? "Edit name" : "Add a name"} onClick={() => setNameEdit({ token: m.token, value: m.name ?? "" })}>{m.name ? "✎" : "+ name"}</button>
                    </div>
                  )}
                  <div className="note-line" title="Bank statement line — not editable">{m.statement}</div>
                </td>
                <td>
                  <select value={m.categoryKey ?? ""} onChange={(e) => e.target.value && setCat.mutate({ token: m.token, categoryKey: e.target.value })}>
                    <option value="">—</option>
                    {catNames.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                  </select>
                </td>
                <td className="num">{formatGBP(m.monthlyTypical)}</td>
                <td className="num">{formatGBP(m.totalSpent)}</td>
                <td className="num">{m.txnCount}</td>
                <td className="td-date">{relativeDate(m.lastDate)}</td>
                <td>
                  <select value={m.override} onChange={(e) => setType.mutate({ token: m.token, recurring: e.target.value as MerchantDTO["override"] })} title={`Detected: ${TYPE_LABEL[m.detected]}`}>
                    <option value="auto">Auto · {TYPE_LABEL[m.detected]}</option>
                    <option value="fixed">Recurring</option>
                    <option value="variable">Variable</option>
                    <option value="ignore">Ignore</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="muted">No merchants{tab !== "all" ? " in this view" : " yet — sync some transactions"}.</p>}
      </div>
    </div>
  );
}

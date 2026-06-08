import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.ts";
import type { TransactionDTO, BankDTO } from "../../../shared/types.ts";
import { formatMoney } from "../format.ts";
import { AccountSelector } from "../components/AccountSelector.tsx";
import { AddTransaction } from "../components/AddTransaction.tsx";
import { ReconcileSheet } from "../components/ReconcileSheet.tsx";

export default function Transactions() {
  const [params] = useSearchParams();
  const accountId = params.get("account") ?? undefined;
  const [rows, setRows] = useState<TransactionDTO[]>([]);
  const [banks, setBanks] = useState<BankDTO[]>([]);
  const [q, setQ] = useState("");

  const loadBanks = () => api.accounts().then(setBanks).catch(() => setBanks([]));
  useEffect(() => { loadBanks(); }, []);

  const [catNames, setCatNames] = useState<{ key: string; name: string }[]>([]);
  const [people, setPeople] = useState<{ key: string; name: string }[]>([]);
  const [personFilter, setPersonFilter] = useState("");
  const [catFilter, setCatFilter] = useState("");
  useEffect(() => { api.categoryNames().then(setCatNames).catch(() => setCatNames([])); api.people().then(setPeople).catch(() => setPeople([])); }, []);

  const load = () => api.transactions(q, accountId, personFilter || undefined).then(setRows).catch(() => setRows([]));
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [q, accountId, personFilter]);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    banks.forEach((b) => b.accounts.forEach((a) => m.set(a.id, a.displayName)));
    return m;
  }, [banks]);

  const setCategory = async (id: string, category: string) => {
    try { await api.setTxnCategory(id, category); await load(); } catch { /* ignore */ }
  };
  const setPerson = async (id: string, personKey: string | null) => { try { await api.setTxnPerson(id, personKey); await load(); } catch { /* ignore */ } };
  const del = async (id: string) => {
    if (!window.confirm("Delete this manual transaction?")) return;
    try { await api.deleteTxn(id); await load(); } catch { /* ignore */ }
  };

  const [sheetOpen, setSheetOpen] = useState(false);

  // Manual reconcile: filter (incl. "uncategorised only") + bulk-assign.
  const visible = useMemo(
    () => rows.filter((r) => !catFilter || r.category === catFilter),
    [rows, catFilter],
  );
  const unreconciledCount = useMemo(() => rows.filter((r) => r.category === "uncategorised").length, [rows]);
  const showingUnreconciled = catFilter === "uncategorised";
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState("");
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((r) => r.id)));
  const applyBulk = async () => {
    if (!bulkCat || selected.size === 0) return;
    try { await api.bulkCategory([...selected], bulkCat); setSelected(new Set()); setBulkCat(""); await load(); } catch { /* ignore */ }
  };
  useEffect(() => { setSelected(new Set()); }, [q, accountId, personFilter, catFilter]);

  return (
    <div>
      <div className="row-between">
        <h1>Transactions <select value={personFilter} onChange={(e) => setPersonFilter(e.target.value)} style={{ fontSize: 13, marginLeft: 8 }}>
          <option value="">Everyone</option>
          <option value="none">Unassigned</option>
          {people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
        </select></h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className={showingUnreconciled ? "btn-primary" : undefined} onClick={() => setCatFilter(showingUnreconciled ? "" : "uncategorised")}>
            {showingUnreconciled ? "Show all" : `Unreconciled (${unreconciledCount})`}
          </button>
          <button className="btn-primary" onClick={() => setSheetOpen(true)} disabled={sheetOpen}>Reconcile</button>
          <AccountSelector />
        </div>
      </div>
      <ReconcileSheet open={sheetOpen} accountId={accountId && accountId !== "all" ? accountId : undefined} onClose={() => setSheetOpen(false)} onDone={load} />
      <AddTransaction onAdded={load} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input placeholder="Search transactions…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ fontSize: 13 }}>
          <option value="">All categories</option>
          <option value="uncategorised">Uncategorised only</option>
          {catNames.filter((c) => c.key !== "uncategorised").map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
        </select>
        <span className="muted" style={{ fontSize: 12 }}>{visible.length} shown</span>
      </div>
      {selected.size > 0 && (
        <div className="card" style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <strong>{selected.size} selected</strong>
          <span className="muted">→</span>
          <select value={bulkCat} onChange={(e) => setBulkCat(e.target.value)}>
            <option value="">— category —</option>
            {catNames.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
          <button className="btn-primary btn-sm" onClick={applyBulk} disabled={!bulkCat}>Assign</button>
          <button className="btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      <div className="card" style={{ marginTop: 16 }}>
        <table className="txn-table">
          <colgroup>
            <col style={{ width: 36 }} />
            <col style={{ width: 104 }} />
            <col style={{ width: 150 }} />
            <col />
            <col style={{ width: 230 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 112 }} />
            <col style={{ width: 44 }} />
          </colgroup>
          <thead><tr>
            <th><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} title="Select all shown" /></th>
            <th>Date</th><th>Account</th><th>Name</th><th>Category</th><th>Person</th><th>Amount</th><th></th>
          </tr></thead>
          <tbody>
            {visible.map((r) => {
              const acct = nameById.get(r.accountId) ?? r.accountId.slice(-4);
              return (
              <tr key={r.id} className={selected.has(r.id) ? "row-selected" : undefined}>
                <td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td className="td-date">{r.bookingDate ?? ""}</td>
                <td className="td-clip" title={acct}>
                  {acct}
                  {r.source === "MANUAL" && <span className="badge manual" style={{ marginLeft: 8 }}>manual</span>}
                </td>
                <td className="td-clip" title={r.name ?? r.remittanceInfo ?? ""}>{r.name ?? r.remittanceInfo ?? ""}</td>
                <td>
                  <select value={r.category} onChange={(e) => setCategory(r.id, e.target.value)}>
                    {catNames.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                  </select>
                </td>
                <td>
                  <select value={r.personKey ?? ""} onChange={(e) => setPerson(r.id, e.target.value || null)}>
                    <option value="">—</option>
                    {people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
                  </select>
                </td>
                <td className={`num td-amount ${Number(r.amount) < 0 ? "neg" : "pos"}`}>{r.currency} {formatMoney(r.amount)}</td>
                <td>{r.source === "MANUAL" && <button className="btn-danger btn-sm" onClick={() => del(r.id)}>✕</button>}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

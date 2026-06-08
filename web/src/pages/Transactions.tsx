import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.ts";
import type { TransactionDTO, CategoryNameDTO, PersonDTO } from "../../../shared/types.ts";
import { formatMoney } from "../format.ts";
import { useToast } from "../components/Toasts.tsx";
import { AccountSelector } from "../components/AccountSelector.tsx";
import { AddTransaction } from "../components/AddTransaction.tsx";
import { ReconcileSheet } from "../components/ReconcileSheet.tsx";

type PropField = "category" | "person";

export default function Transactions() {
  const [params] = useSearchParams();
  const accountId = params.get("account") ?? undefined;
  const qc = useQueryClient();
  const { notify, update } = useToast();

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const [personFilter, setPersonFilter] = useState("");
  const [catFilter, setCatFilter] = useState("");

  // ── Queries ────────────────────────────────────────────────────────────
  const txnKey = useMemo(
    () => ["transactions", debouncedQ, accountId, personFilter] as const,
    [debouncedQ, accountId, personFilter],
  );

  const txnQuery = useQuery({
    queryKey: txnKey,
    queryFn: () => api.transactions(debouncedQ, accountId, personFilter || undefined),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => txnQuery.data ?? [], [txnQuery.data]);

  const catNamesQuery = useQuery({
    queryKey: ["categoryNames"],
    queryFn: () => api.categoryNames(),
    staleTime: 5 * 60_000,
  });
  const catNames = useMemo<CategoryNameDTO[]>(() => catNamesQuery.data ?? [], [catNamesQuery.data]);

  const peopleQuery = useQuery({
    queryKey: ["people"],
    queryFn: () => api.people(),
    staleTime: 5 * 60_000,
  });
  const people = useMemo<PersonDTO[]>(() => peopleQuery.data ?? [], [peopleQuery.data]);

  const invalidateTxns = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["transactions"] });
  }, [qc]);

  const rowName = useCallback(
    (id: string) => {
      const r = rows.find((x) => x.id === id);
      return r?.name ?? r?.remittanceInfo ?? "this merchant";
    },
    [rows],
  );

  // ── Propagation (apply-to-matching) mutation ───────────────────────────
  const applyMutation = useMutation({
    mutationFn: ({ id, fields }: { id: string; fields: PropField[] }) => api.applyToMatching(id, fields),
    onMutate: ({ fields }) => {
      const tid = notify(`Applying ${fields.join(" & ")} to matching transactions…`, {
        tone: "loading",
        duration: 0,
      });
      return { tid };
    },
    onSuccess: (res, _vars, ctx) => {
      if (ctx) update(ctx.tid, `Applied to ${res.matched} matching transactions`, { tone: "success" });
      invalidateTxns();
    },
    onError: (err: Error, _vars, ctx) => {
      if (ctx) update(ctx.tid, err.message, { tone: "error" });
    },
  });

  // After a category/person edit, offer a single (mergeable) propagation toast.
  const offerRef = useRef<{ rowId: string; toastId: number; fields: PropField[] } | null>(null);

  const offerPropagation = useCallback(
    (id: string, field: PropField) => {
      const merchant = rowName(id);
      const existing = offerRef.current;
      const fields: PropField[] =
        existing && existing.rowId === id && !existing.fields.includes(field)
          ? [...existing.fields, field]
          : existing && existing.rowId === id
            ? existing.fields
            : [field];
      const label = `Apply ${fields.join(" & ")} to all matching`;
      const action = { label, onClick: () => applyMutation.mutate({ id, fields }) };

      if (existing && existing.rowId === id) {
        update(existing.toastId, `Updated ${merchant}`, { tone: "success", action });
        offerRef.current = { rowId: id, toastId: existing.toastId, fields };
      } else {
        const toastId = notify(`Updated ${merchant}`, { tone: "success", action });
        offerRef.current = { rowId: id, toastId, fields };
      }
    },
    [applyMutation, notify, rowName, update],
  );

  // ── Row mutations (optimistic, in-place) ───────────────────────────────
  const patchRow = (id: string, patch: Partial<TransactionDTO>) => {
    qc.setQueriesData<TransactionDTO[]>({ queryKey: ["transactions"] }, (old) =>
      old ? old.map((r) => (r.id === id ? { ...r, ...patch } : r)) : old,
    );
  };
  const snapshotTxns = () => qc.getQueriesData<TransactionDTO[]>({ queryKey: ["transactions"] });
  const restoreTxns = (snap: ReturnType<typeof snapshotTxns>) => {
    for (const [key, data] of snap) qc.setQueryData(key, data);
  };

  const categoryMutation = useMutation({
    mutationFn: ({ id, category }: { id: string; category: string }) => api.setTxnCategory(id, category),
    onMutate: async ({ id, category }) => {
      await qc.cancelQueries({ queryKey: ["transactions"] });
      const snap = snapshotTxns();
      patchRow(id, { category });
      return { snap };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) restoreTxns(ctx.snap);
      notify("Couldn't update category", { tone: "error" });
    },
    onSuccess: (_res, { id }) => offerPropagation(id, "category"),
  });

  const personMutation = useMutation({
    mutationFn: ({ id, personKey }: { id: string; personKey: string | null }) => api.setTxnPerson(id, personKey),
    onMutate: async ({ id, personKey }) => {
      await qc.cancelQueries({ queryKey: ["transactions"] });
      const snap = snapshotTxns();
      const personName = personKey ? (people.find((p) => p.key === personKey)?.name ?? null) : null;
      patchRow(id, { personKey, personName });
      return { snap };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) restoreTxns(ctx.snap);
      notify("Couldn't update person", { tone: "error" });
    },
    onSuccess: (_res, { id }) => offerPropagation(id, "person"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteTxn(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["transactions"] });
      const snap = snapshotTxns();
      qc.setQueriesData<TransactionDTO[]>({ queryKey: ["transactions"] }, (old) =>
        old ? old.filter((r) => r.id !== id) : old,
      );
      return { snap };
    },
    onError: (_err, _id, ctx) => {
      if (ctx) restoreTxns(ctx.snap);
      notify("Couldn't delete transaction", { tone: "error" });
    },
    onSuccess: () => notify("Transaction deleted", { tone: "success" }),
  });

  const bulkMutation = useMutation({
    mutationFn: ({ ids, category }: { ids: string[]; category: string }) => api.bulkCategory(ids, category),
    onMutate: ({ ids }) => {
      const tid = notify(`Assigning ${ids.length} transactions…`, { tone: "loading", duration: 0 });
      return { tid };
    },
    onSuccess: (_res, { ids }, ctx) => {
      if (ctx) update(ctx.tid, `Assigned ${ids.length} transactions`, { tone: "success" });
      invalidateTxns();
      setSelected(new Set());
      setBulkCat("");
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) update(ctx.tid, "Couldn't assign transactions", { tone: "error" });
      else notify("Couldn't assign transactions", { tone: "error" });
    },
  });

  const setCategory = (id: string, category: string) => categoryMutation.mutate({ id, category });
  const setPerson = (id: string, personKey: string | null) => personMutation.mutate({ id, personKey });
  const del = (id: string) => {
    if (!window.confirm("Delete this manual transaction?")) return;
    deleteMutation.mutate(id);
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
  const applyBulk = () => {
    if (!bulkCat || selected.size === 0) return;
    bulkMutation.mutate({ ids: [...selected], category: bulkCat });
  };
  useEffect(() => { setSelected(new Set()); }, [debouncedQ, accountId, personFilter, catFilter]);

  const isInitialLoad = txnQuery.isLoading;
  const isUpdating = txnQuery.isFetching && !txnQuery.isLoading;

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
      <ReconcileSheet open={sheetOpen} accountId={accountId && accountId !== "all" ? accountId : undefined} onClose={() => setSheetOpen(false)} onDone={invalidateTxns} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input placeholder="Search transactions…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: "1 1 220px", maxWidth: 320 }} />
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ fontSize: 13 }}>
          <option value="">All categories</option>
          <option value="uncategorised">Uncategorised only</option>
          {catNames.filter((c) => c.key !== "uncategorised").map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
        </select>
        <span className="muted" style={{ fontSize: 12 }}>{visible.length} shown</span>
        {isInitialLoad && <span className="muted" style={{ fontSize: 12 }}>Loading…</span>}
        {isUpdating && <span className="muted" style={{ fontSize: 12 }}>Updating…</span>}
        <div style={{ marginLeft: "auto" }}><AddTransaction onAdded={invalidateTxns} /></div>
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
              const acct = r.accountName;
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

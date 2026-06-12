import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryState, parseAsBoolean } from "nuqs";
import { api } from "../api.ts";
import type { TransactionDTO, CategoryNameDTO, PersonDTO, AuditEvent } from "../../../shared/types.ts";
import { formatMoney, relativeDate } from "../format.ts";
import { useToast } from "../components/Toasts.tsx";
import { AccountSelector } from "../components/AccountSelector.tsx";
import { AddTransaction } from "../components/AddTransaction.tsx";
import { AuditSheet } from "../components/AuditSheet.tsx";
import { BrandLogo } from "../components/BrandLogo.tsx";
import { Combobox } from "../components/Combobox.tsx";
import { TxnDrawer } from "../components/TxnDrawer.tsx";
import { PageHeader, useConfirm } from "../components/ui";
import { Receipt, Send } from "lucide-react";

type PropField = "category" | "person";
type Flag = "red" | "orange" | "yellow" | null;

export default function Transactions() {
  const [params] = useSearchParams();
  const accountId = params.get("account") ?? undefined;
  const qc = useQueryClient();
  const { notify, update } = useToast();
  const confirm = useConfirm();

  // Filters live in the URL query string (nuqs), so they're shareable/bookmarkable.
  const [q, setQ] = useQueryState("q", { defaultValue: "", history: "replace" });
  const [debouncedQ, setDebouncedQ] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const [personFilter, setPersonFilter] = useQueryState("person", { defaultValue: "", history: "replace" });
  const [catFilter, setCatFilter] = useQueryState("category", { defaultValue: "", history: "replace" });
  const [month, setMonth] = useQueryState("month", { defaultValue: "", history: "replace" });
  const [merchant, setMerchant] = useQueryState("merchant", { defaultValue: "", history: "replace" });

  // ── Queries ────────────────────────────────────────────────────────────
  const txnKey = useMemo(
    () => ["transactions", debouncedQ, accountId, personFilter, month, merchant] as const,
    [debouncedQ, accountId, personFilter, month, merchant],
  );

  const txnQuery = useQuery({
    queryKey: txnKey,
    queryFn: () => api.transactions(debouncedQ, accountId, personFilter || undefined, month || undefined, merchant || undefined),
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

  // Existing merchant names for the rename picker.
  const merchantNamesQuery = useQuery({ queryKey: ["merchantNames"], queryFn: () => api.merchantNames(), staleTime: 5 * 60_000 });
  const merchantOptions = useMemo(() => (merchantNamesQuery.data ?? []).map((n) => ({ value: n, label: n })), [merchantNamesQuery.data]);
  const merchantNameSet = useMemo(() => new Set(merchantNamesQuery.data ?? []), [merchantNamesQuery.data]);
  const nameOptions = (name: string | null) => {
    const cur = name?.trim();
    return cur && !merchantNameSet.has(cur) ? [{ value: cur, label: cur }, ...merchantOptions] : merchantOptions;
  };

  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: () => api.accounts(), staleTime: 5 * 60_000 });
  const liabilities = useMemo(() => (accountsQuery.data ?? []).flatMap((b) => b.accounts).filter((a) => a.source === "LIABILITY"), [accountsQuery.data]);
  const debtName = (id: string | null) => liabilities.find((l) => l.id === id)?.displayName ?? "debt";
  // accountId → owning bank, so each row's account can show its bank logo.
  const bankByAccount = useMemo(() => {
    const m: Record<string, { name: string; logo: string | null }> = {};
    for (const b of accountsQuery.data ?? []) for (const a of b.accounts) m[a.id] = { name: b.institutionName, logo: b.institutionLogo };
    return m;
  }, [accountsQuery.data]);

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
        update(existing.toastId, `Updated ${merchant}`, { tone: "success", action, duration: 10000 });
        offerRef.current = { rowId: id, toastId: existing.toastId, fields };
      } else {
        const toastId = notify(`Updated ${merchant}`, { tone: "success", action, duration: 10000 });
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

  const noteMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string | null }) => api.setTxnNote(id, note),
    onMutate: async ({ id, note }) => {
      await qc.cancelQueries({ queryKey: ["transactions"] });
      const snap = snapshotTxns();
      patchRow(id, { note: note?.trim() ? note.trim() : null });
      return { snap };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) restoreTxns(ctx.snap);
      notify("Couldn't save note", { tone: "error" });
    },
  });

  const nameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.renameTxn(id, name),
    onMutate: async ({ id, name }) => {
      await qc.cancelQueries({ queryKey: ["transactions"] });
      const snap = snapshotTxns();
      patchRow(id, { name: name.trim() || null });
      return { snap };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) restoreTxns(ctx.snap);
      notify("Couldn't rename", { tone: "error" });
    },
  });

  const flagMutation = useMutation({
    mutationFn: ({ id, flag }: { id: string; flag: Flag }) => api.setTxnFlag(id, flag),
    onMutate: async ({ id, flag }) => {
      await qc.cancelQueries({ queryKey: ["transactions"] });
      const snap = snapshotTxns();
      patchRow(id, { flag });
      return { snap };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) restoreTxns(ctx.snap);
      notify("Couldn't update flag", { tone: "error" });
    },
  });

  const invalidateAfterDebt = () => { invalidateTxns(); qc.invalidateQueries({ queryKey: ["accounts"] }); qc.invalidateQueries({ queryKey: ["summary"] }); };
  const linkMut = useMutation({
    mutationFn: ({ id, debtAccountId }: { id: string; debtAccountId: string }) => api.linkDebt(id, debtAccountId),
    onSuccess: () => { invalidateAfterDebt(); notify("Linked as repayment — debt reduced", { tone: "success" }); },
    onError: (e: Error) => notify(e.message, { tone: "error" }),
  });
  const unlinkMut = useMutation({
    mutationFn: (id: string) => api.unlinkDebt(id),
    onSuccess: invalidateAfterDebt,
    onError: (e: Error) => notify(e.message, { tone: "error" }),
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
  const del = async (id: string) => {
    if (await confirm({ title: "Delete this transaction?", body: "This manual transaction will be permanently removed.", danger: true })) {
      deleteMutation.mutate(id);
    }
  };
  const unlinkRepayment = async (id: string) => {
    if (await confirm({ title: "Unlink this repayment?", body: "Restores the debt balance by this amount.", confirmLabel: "Unlink", danger: true })) {
      unlinkMut.mutate(id);
    }
  };

  // The transaction whose detail/edit sidebar is open (click a row to open).
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const scopedAccount = accountId && accountId !== "all" ? accountId : undefined;
  const reconcileRun = useCallback((onEvent: (e: AuditEvent) => void) => api.reconcileStream(onEvent, scopedAccount), [scopedAccount]);

  // Manual reconcile: filter (incl. "uncategorised only") + bulk-assign.
  const [flaggedOnly, setFlaggedOnly] = useQueryState("flagged", parseAsBoolean.withDefault(false).withOptions({ history: "replace" }));
  const visible = useMemo(
    () => rows.filter((r) => (!catFilter || r.category === catFilter) && (!flaggedOnly || r.flag != null)),
    [rows, catFilter, flaggedOnly],
  );
  const drawerTxn = useMemo(() => visible.find((t) => t.id === drawerId) ?? null, [visible, drawerId]);
  const unreconciledCount = useMemo(() => rows.filter((r) => r.category === "uncategorised").length, [rows]);
  const flaggedCount = useMemo(() => rows.filter((r) => r.flag != null).length, [rows]);
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
  useEffect(() => { setSelected(new Set()); }, [debouncedQ, accountId, personFilter, catFilter, flaggedOnly, month, merchant]);

  const isInitialLoad = txnQuery.isLoading;
  const isUpdating = txnQuery.isFetching && !txnQuery.isLoading;

  return (
    <div className="txn-page">
      <PageHeader
        title={<>Transactions <select value={personFilter} onChange={(e) => setPersonFilter(e.target.value)} style={{ fontSize: 13, marginLeft: 8 }}>
          <option value="">Everyone</option>
          <option value="none">Unassigned</option>
          {people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
        </select></>}
        actions={<>
          <button className={showingUnreconciled ? "btn-primary" : undefined} onClick={() => setCatFilter(showingUnreconciled ? "" : "uncategorised")}>
            {showingUnreconciled ? "Show all" : `Unreconciled (${unreconciledCount})`}
          </button>
          <button className={flaggedOnly ? "btn-primary" : undefined} onClick={() => setFlaggedOnly((v) => !v)} title="Show only flagged transactions">
            ⚑ Flagged ({flaggedCount})
          </button>
          <button className="btn-primary" onClick={() => setSheetOpen(true)} disabled={sheetOpen}>Reconcile</button>
          <AccountSelector />
        </>}
      />
      <AuditSheet open={sheetOpen} title="Reconcile" run={reconcileRun} onClose={() => setSheetOpen(false)} onDone={invalidateTxns} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input placeholder="Search transactions…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: "1 1 220px", maxWidth: 320 }} />
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ fontSize: 13 }}>
          <option value="">All categories</option>
          <option value="uncategorised">Uncategorised only</option>
          {catNames.filter((c) => c.key !== "uncategorised").map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
        </select>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: "auto", fontSize: 13 }} title="Filter by month" />
        {month && <button className="btn-sm" onClick={() => setMonth("")}>All months</button>}
        {merchant && <button className="btn-sm" onClick={() => setMerchant("")} title="Clear merchant filter">Merchant: {merchant} ✕</button>}
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
          </colgroup>
          <thead><tr>
            <th><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} title="Select all shown" /></th>
            <th>Date</th><th>Account</th><th>Name</th><th>Category</th><th>Person</th><th>Amount</th>
          </tr></thead>
          <tbody>
            {visible.map((r) => {
              const acct = r.accountName;
              return (
              <tr key={r.id} className={["txn-row", selected.has(r.id) ? "row-selected" : "", r.flag ? `flag-row-${r.flag}` : ""].filter(Boolean).join(" ")} onClick={() => setDrawerId(r.id)}>
                <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td className="td-date" title={r.bookingDate ?? ""}>{relativeDate(r.bookingDate)}</td>
                <td title={acct}>
                  <span className="txn-acct">
                    {r.origin === "telegram" || r.origin === "receipt"
                      ? <span className="tg-avatar" title="Added via Telegram"><Send size={13} strokeWidth={2.2} /></span>
                      : <BrandLogo name={bankByAccount[r.accountId]?.name ?? acct} src={bankByAccount[r.accountId]?.logo} size={24} />}
                    <span className="td-clip">{acct}</span>
                    {r.origin === "manual" && <span className="badge manual">manual</span>}
                  </span>
                </td>
                <td>
                  <div className="td-name" onClick={(e) => e.stopPropagation()}>
                    <Combobox
                      value={r.name?.trim() || r.remittanceInfo?.trim() || null}
                      options={nameOptions(r.name?.trim() || r.remittanceInfo?.trim() || null)}
                      onChange={(v) => { if (v) nameMutation.mutate({ id: r.id, name: v }); }}
                      placeholder="Add name"
                      allowCustom
                    />
                    {r.order && (r.order.items.length > 0 || r.order.hasAttachment) && (
                      <span className="order-tag" title="Has a receipt — open to view"><Receipt size={12} strokeWidth={1.9} />{r.order.items.length > 0 && <span className="order-tag-count">{r.order.items.length}</span>}</span>
                    )}
                  </div>
                  {r.note && <div className="note-line">{r.note}</div>}
                  {r.debtAccountId && <div className="note-line" title="Debt repayment">⛓ repayment → {debtName(r.debtAccountId)}</div>}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <select value={r.category} onChange={(e) => setCategory(r.id, e.target.value)}>
                    {catNames.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                  </select>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <select value={r.personKey ?? ""} onChange={(e) => setPerson(r.id, e.target.value || null)}>
                    <option value="">—</option>
                    {people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
                  </select>
                </td>
                <td className={`num td-amount ${Number(r.amount) < 0 ? "neg" : "pos"}`}>{r.currency} {formatMoney(r.amount)}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {drawerTxn && (
        <TxnDrawer
          txn={drawerTxn}
          onClose={() => setDrawerId(null)}
          catNames={catNames}
          people={people}
          liabilities={liabilities}
          debtName={debtName}
          nameOptions={nameOptions}
          onRename={(name) => nameMutation.mutate({ id: drawerTxn.id, name })}
          onCategory={(key) => setCategory(drawerTxn.id, key)}
          onPerson={(key) => setPerson(drawerTxn.id, key)}
          onNote={(note) => noteMutation.mutate({ id: drawerTxn.id, note })}
          onFlag={(flag) => flagMutation.mutate({ id: drawerTxn.id, flag: flag as Flag })}
          onDelete={() => { del(drawerTxn.id); setDrawerId(null); }}
          onLinkDebt={(debtId) => linkMut.mutate({ id: drawerTxn.id, debtAccountId: debtId })}
          onUnlinkDebt={() => unlinkRepayment(drawerTxn.id)}
        />
      )}
    </div>
  );
}

import { useCallback, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.ts";
import type { TransactionDTO, CategoryNameDTO, PersonDTO } from "../../../shared/types.ts";
import { useToast } from "../components/Toasts.tsx";
import { useConfirm } from "../components/ui";
import type { ComboOption } from "../components/Combobox.tsx";

type PropField = "category" | "person";
export type Flag = "red" | "orange" | "yellow" | null;

// Shared transaction-editing logic (optimistic, in-place) used by the detail
// drawer. Bundles the reference data (categories, people, liabilities, merchant
// names) with the mutations and the "apply to all matching" propagation toast,
// so a page only needs to render the list + drawer. Classic Transactions keeps
// its own inline copy; v2 (and future pages) use this.
export function useTxnEditing() {
  const qc = useQueryClient();
  const { notify, update } = useToast();
  const confirm = useConfirm();

  const catNamesQuery = useQuery({ queryKey: ["categoryNames"], queryFn: () => api.categoryNames(), staleTime: 5 * 60_000 });
  const catNames = useMemo<CategoryNameDTO[]>(() => catNamesQuery.data ?? [], [catNamesQuery.data]);

  const peopleQuery = useQuery({ queryKey: ["people"], queryFn: () => api.people(), staleTime: 5 * 60_000 });
  const people = useMemo<PersonDTO[]>(() => peopleQuery.data ?? [], [peopleQuery.data]);

  const merchantNamesQuery = useQuery({ queryKey: ["merchantNames"], queryFn: () => api.merchantNames(), staleTime: 5 * 60_000 });
  const merchantOptions = useMemo(() => (merchantNamesQuery.data ?? []).map((n) => ({ value: n, label: n })), [merchantNamesQuery.data]);
  const merchantNameSet = useMemo(() => new Set(merchantNamesQuery.data ?? []), [merchantNamesQuery.data]);
  const nameOptions = useCallback(
    (name: string | null): ComboOption[] => {
      const cur = name?.trim();
      return cur && !merchantNameSet.has(cur) ? [{ value: cur, label: cur }, ...merchantOptions] : merchantOptions;
    },
    [merchantOptions, merchantNameSet],
  );

  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: () => api.accounts(), staleTime: 5 * 60_000 });
  const liabilities = useMemo(() => (accountsQuery.data ?? []).flatMap((b) => b.accounts).filter((a) => a.source === "LIABILITY"), [accountsQuery.data]);
  const debtName = useCallback((id: string | null) => liabilities.find((l) => l.id === id)?.displayName ?? "debt", [liabilities]);
  const bankByAccount = useMemo(() => {
    const m: Record<string, { name: string; logo: string | null }> = {};
    for (const b of accountsQuery.data ?? []) for (const a of b.accounts) m[a.id] = { name: b.institutionName, logo: b.institutionLogo };
    return m;
  }, [accountsQuery.data]);

  const invalidateTxns = useCallback(() => { qc.invalidateQueries({ queryKey: ["transactions"] }); }, [qc]);

  // ── Optimistic patch helpers ───────────────────────────────────────────
  const patchRow = useCallback((id: string, patch: Partial<TransactionDTO>) => {
    qc.setQueriesData<TransactionDTO[]>({ queryKey: ["transactions"] }, (old) => (old ? old.map((r) => (r.id === id ? { ...r, ...patch } : r)) : old));
  }, [qc]);
  const snapshotTxns = useCallback(() => qc.getQueriesData<TransactionDTO[]>({ queryKey: ["transactions"] }), [qc]);
  const restoreTxns = useCallback((snap: ReturnType<typeof snapshotTxns>) => { for (const [key, data] of snap) qc.setQueryData(key, data); }, [qc, snapshotTxns]);

  const rowName = useCallback((id: string) => {
    for (const [, data] of qc.getQueriesData<TransactionDTO[]>({ queryKey: ["transactions"] })) {
      const r = data?.find((x) => x.id === id);
      if (r) return r.name ?? r.remittanceInfo ?? "this merchant";
    }
    return "this merchant";
  }, [qc]);

  // ── Propagation (apply-to-matching) toast ──────────────────────────────
  const applyMutation = useMutation({
    mutationFn: ({ id, fields }: { id: string; fields: PropField[] }) => api.applyToMatching(id, fields),
    onMutate: ({ fields }) => ({ tid: notify(`Applying ${fields.join(" & ")} to matching transactions…`, { tone: "loading", duration: 0 }) }),
    onSuccess: (res, _vars, ctx) => { if (ctx) update(ctx.tid, `Applied to ${res.matched} matching transactions`, { tone: "success" }); invalidateTxns(); },
    onError: (err: Error, _vars, ctx) => { if (ctx) update(ctx.tid, err.message, { tone: "error" }); },
  });
  const offerRef = useRef<{ rowId: string; toastId: number; fields: PropField[] } | null>(null);
  const offerPropagation = useCallback((id: string, field: PropField) => {
    const merchant = rowName(id);
    const existing = offerRef.current;
    const fields: PropField[] =
      existing && existing.rowId === id && !existing.fields.includes(field) ? [...existing.fields, field]
        : existing && existing.rowId === id ? existing.fields : [field];
    const action = { label: `Apply ${fields.join(" & ")} to all matching`, onClick: () => applyMutation.mutate({ id, fields }) };
    if (existing && existing.rowId === id) {
      update(existing.toastId, `Updated ${merchant}`, { tone: "success", action, duration: 10000 });
      offerRef.current = { rowId: id, toastId: existing.toastId, fields };
    } else {
      offerRef.current = { rowId: id, toastId: notify(`Updated ${merchant}`, { tone: "success", action, duration: 10000 }), fields };
    }
  }, [applyMutation, notify, rowName, update]);

  // ── Field mutations ────────────────────────────────────────────────────
  const categoryMutation = useMutation({
    mutationFn: ({ id, category }: { id: string; category: string }) => api.setTxnCategory(id, category),
    onMutate: async ({ id, category }) => { await qc.cancelQueries({ queryKey: ["transactions"] }); const snap = snapshotTxns(); patchRow(id, { category }); return { snap }; },
    onError: (_e, _v, ctx) => { if (ctx) restoreTxns(ctx.snap); notify("Couldn't update category", { tone: "error" }); },
    onSuccess: (_r, { id }) => offerPropagation(id, "category"),
  });
  const personMutation = useMutation({
    mutationFn: ({ id, personKey }: { id: string; personKey: string | null }) => api.setTxnPerson(id, personKey),
    onMutate: async ({ id, personKey }) => { await qc.cancelQueries({ queryKey: ["transactions"] }); const snap = snapshotTxns(); const personName = personKey ? (people.find((p) => p.key === personKey)?.name ?? null) : null; patchRow(id, { personKey, personName }); return { snap }; },
    onError: (_e, _v, ctx) => { if (ctx) restoreTxns(ctx.snap); notify("Couldn't update person", { tone: "error" }); },
    onSuccess: (_r, { id }) => offerPropagation(id, "person"),
  });
  const noteMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string | null }) => api.setTxnNote(id, note),
    onMutate: async ({ id, note }) => { await qc.cancelQueries({ queryKey: ["transactions"] }); const snap = snapshotTxns(); patchRow(id, { note: note?.trim() ? note.trim() : null }); return { snap }; },
    onError: (_e, _v, ctx) => { if (ctx) restoreTxns(ctx.snap); notify("Couldn't save note", { tone: "error" }); },
  });
  const nameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.renameTxn(id, name),
    onMutate: async ({ id, name }) => { await qc.cancelQueries({ queryKey: ["transactions"] }); const snap = snapshotTxns(); patchRow(id, { name: name.trim() || null }); return { snap }; },
    onError: (_e, _v, ctx) => { if (ctx) restoreTxns(ctx.snap); notify("Couldn't rename", { tone: "error" }); },
  });
  const flagMutation = useMutation({
    mutationFn: ({ id, flag }: { id: string; flag: Flag }) => api.setTxnFlag(id, flag),
    onMutate: async ({ id, flag }) => { await qc.cancelQueries({ queryKey: ["transactions"] }); const snap = snapshotTxns(); patchRow(id, { flag }); return { snap }; },
    onError: (_e, _v, ctx) => { if (ctx) restoreTxns(ctx.snap); notify("Couldn't update flag", { tone: "error" }); },
  });

  const invalidateAfterDebt = useCallback(() => { invalidateTxns(); qc.invalidateQueries({ queryKey: ["accounts"] }); qc.invalidateQueries({ queryKey: ["summary"] }); }, [invalidateTxns, qc]);
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
    onMutate: async (id) => { await qc.cancelQueries({ queryKey: ["transactions"] }); const snap = snapshotTxns(); qc.setQueriesData<TransactionDTO[]>({ queryKey: ["transactions"] }, (old) => (old ? old.filter((r) => r.id !== id) : old)); return { snap }; },
    onError: (_e, _id, ctx) => { if (ctx) restoreTxns(ctx.snap); notify("Couldn't delete transaction", { tone: "error" }); },
    onSuccess: () => notify("Transaction deleted", { tone: "success" }),
  });

  const del = useCallback(async (id: string) => {
    if (await confirm({ title: "Delete this transaction?", body: "This manual transaction will be permanently removed.", danger: true })) deleteMutation.mutate(id);
  }, [confirm, deleteMutation]);
  const unlinkRepayment = useCallback(async (id: string) => {
    if (await confirm({ title: "Unlink this repayment?", body: "Restores the debt balance by this amount.", confirmLabel: "Unlink", danger: true })) unlinkMut.mutate(id);
  }, [confirm, unlinkMut]);

  return {
    catNames, people, liabilities, debtName, nameOptions, bankByAccount, invalidateTxns,
    rename: (id: string, name: string) => nameMutation.mutate({ id, name }),
    setCategory: (id: string, category: string) => categoryMutation.mutate({ id, category }),
    setPerson: (id: string, personKey: string | null) => personMutation.mutate({ id, personKey }),
    setNote: (id: string, note: string | null) => noteMutation.mutate({ id, note }),
    setFlag: (id: string, flag: Flag) => flagMutation.mutate({ id, flag }),
    del, linkDebt: (id: string, debtAccountId: string) => linkMut.mutate({ id, debtAccountId }), unlinkRepayment,
  };
}

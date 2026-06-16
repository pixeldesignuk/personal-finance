import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { api } from "../api.ts";
import type { DebtsDTO, DebtDTO } from "../../../shared/types.ts";
import { formatGBP, relativeDate } from "../format.ts";
import { useToast } from "../components/Toasts.tsx";
import { PageHeader, Stat, EmptyState, Modal, Tabs, Field, FieldRow, Toggle, useConfirm, type TabItem } from "../components/ui";

const STRATEGIES: TabItem[] = [{ key: "custom", label: "Custom" }, { key: "snowball", label: "Snowball" }, { key: "avalanche", label: "Avalanche" }];

function payoffDate(months: number | null): string {
  if (months == null) return "—";
  if (months <= 0) return "now";
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

export default function Debts() {
  const qc = useQueryClient();
  const { notify } = useToast();
  const { data } = useQuery({ queryKey: ["debts"], queryFn: () => api.debts() });
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: () => api.accounts(), staleTime: 5 * 60_000 });
  const cashAccounts = useMemo(() => (accountsQuery.data ?? []).flatMap((b) => b.accounts).filter((a) => a.source === "MANUAL"), [accountsQuery.data]);
  const confirm = useConfirm();

  const [strategy, setStrategy] = useQueryState("strategy", { defaultValue: "custom", history: "replace" });

  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", owed: "0", rate: "", priority: "0", target: "", excluded: false });
  const [payOpen, setPayOpen] = useState(false);
  const [payFor, setPayFor] = useState<DebtDTO | null>(null);
  const [pay, setPay] = useState({ amount: "", date: new Date().toLocaleDateString("en-CA"), accountId: "" });

  const refresh = () => { qc.invalidateQueries({ queryKey: ["debts"] }); qc.invalidateQueries({ queryKey: ["summary"] }); qc.invalidateQueries({ queryKey: ["accounts"] }); qc.invalidateQueries({ queryKey: ["accounts-health"] }); };

  const saveDebt = useMutation({
    mutationFn: async () => {
      const rate = form.rate.trim() ? form.rate.trim() : null;
      const priority = form.priority.trim() ? Number(form.priority) : null;
      const target = form.target.trim() ? form.target.trim() : null;
      if (editId) return api.patchAccount(editId, { name: form.name.trim(), manualBalance: form.owed.trim() || "0", interestRate: rate, priority, targetPayment: target, debtExcluded: form.excluded });
      const { id } = await api.createManualAccount({ name: form.name.trim(), type: "PERSONAL", source: "LIABILITY", manualBalance: form.owed.trim() || "0", interestRate: rate ?? undefined });
      await api.patchAccount(id, { priority, targetPayment: target, debtExcluded: form.excluded });
    },
    onSuccess: () => { refresh(); setEditOpen(false); },
    onError: (e: Error) => notify(e.message, { tone: "error" }),
  });
  const delDebt = useMutation({
    mutationFn: (id: string) => api.deleteManualAccount(id),
    onSuccess: refresh,
    onError: (e: Error) => notify(e.message, { tone: "error" }),
  });
  const askDelDebt = async (d: DebtDTO) => {
    if (await confirm({ title: `Delete ${d.name}?`, body: "Removes the debt and its logged repayments.", danger: true })) delDebt.mutate(d.id);
  };
  const recordPayment = useMutation({
    mutationFn: async () => {
      if (!payFor) throw new Error("No debt");
      const amt = Number(pay.amount);
      if (!(amt > 0)) throw new Error("Enter an amount");
      if (!pay.accountId) throw new Error("Pick the account you paid from");
      const { id } = await api.createTxn({ accountId: pay.accountId, date: pay.date, amount: `-${amt}`, category: "transfer", note: `Repayment → ${payFor.name}` });
      await api.linkDebt(id, payFor.id);
    },
    onSuccess: () => { refresh(); setPayOpen(false); notify("Payment recorded — debt reduced", { tone: "success" }); },
    onError: (e: Error) => notify(e.message, { tone: "error" }),
  });

  const openNew = () => { setEditId(null); setForm({ name: "", owed: "0", rate: "", priority: "0", target: "", excluded: false }); setEditOpen(true); };
  const openEdit = (d: DebtDTO) => { setEditId(d.id); setForm({ name: d.name, owed: String(d.balance), rate: d.interestRate != null ? String(d.interestRate) : "", priority: String(d.priority), target: d.targetPayment != null ? String(d.targetPayment) : "", excluded: d.excluded }); setEditOpen(true); };
  const openPay = (d: DebtDTO) => { setPayFor(d); setPay({ amount: "", date: new Date().toLocaleDateString("en-CA"), accountId: cashAccounts[0]?.id ?? "" }); setPayOpen(true); };

  const mainDebts = (data?.debts ?? []).filter((d) => !d.excluded);
  const excludedDebts = (data?.debts ?? []).filter((d) => d.excluded);
  const active = mainDebts.filter((d) => d.balance > 0);
  const order = useMemo(() => {
    const a = [...active];
    if (strategy === "avalanche") a.sort((x, y) => (y.interestRate ?? -1) - (x.interestRate ?? -1));
    else if (strategy === "snowball") a.sort((x, y) => x.balance - y.balance);
    else a.sort((x, y) => x.priority - y.priority || x.balance - y.balance); // custom
    return a;
  }, [active, strategy]);
  const totalPlanned = active.reduce((s, d) => s + (d.targetPayment ?? 0), 0);
  const debtFreeMonths = active.reduce((m, d) => Math.max(m, d.projectedMonths ?? 0), 0);

  return (
    <div>
      <PageHeader title="Debt" actions={<button className="btn-primary" onClick={openNew}>Add debt</button>} />

      {data && (
        <div className="grid">
          <Stat label="Total owed" value={formatGBP(data.totalOwed)} valueTone="neg" />
          <Stat label="Repaid to date" value={formatGBP(data.totalPaid)} valueTone="pos" />
          <Stat label="Monthly pace" value={formatGBP(data.monthlyTotal)} />
          <Stat label="Debt-free" value={debtFreeMonths ? payoffDate(debtFreeMonths) : "—"} delta={debtFreeMonths ? `~${debtFreeMonths} months at current pace` : "log payments to project"} />
        </div>
      )}

      {active.length > 1 && (
        <div className="card">
          <div className="card-head">
            <h3>Payment plan</h3>
            <Tabs value={strategy} onChange={setStrategy} items={STRATEGIES} bare />
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            {strategy === "custom" ? "Your order — set each debt's priority and the (possibly partial) amount to put toward it next (Edit a debt)."
              : strategy === "snowball" ? "Clear the smallest balance first for a quick win, then roll that payment into the next."
              : "Pay the highest-interest debt first to minimise total interest."}
          </p>
          <ol className="debt-order">
            {order.map((d, i) => (
              <li key={d.id}>
                <span className={i === 0 ? "pos" : ""}>{i === 0 ? "▶ " : ""}{strategy === "custom" ? `${d.priority}. ` : ""}{d.name}</span>
                <span className="num">
                  {strategy === "custom" && d.targetPayment != null ? <>{formatGBP(d.targetPayment)} <span className="muted">of {formatGBP(d.balance)}</span></> : <>{formatGBP(d.balance)}{d.interestRate ? ` · ${d.interestRate}%` : ""}</>}
                </span>
              </li>
            ))}
          </ol>
          {strategy === "custom" && totalPlanned > 0 && (
            <div className="row-between" style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
              <strong>Total planned next</strong><span className="num">{formatGBP(totalPlanned)}</span>
            </div>
          )}
        </div>
      )}

      {data?.debts.length === 0 && <EmptyState>No debts yet. Add what you owe (e.g. family/friends, a loan) — interest-free is fine.</EmptyState>}

      {mainDebts.map((d) => {
        const progress = d.original > 0 ? Math.round((d.paidTotal / d.original) * 100) : 0;
        return (
          <div className="card" key={d.id}>
            <div className="card-head" style={{ marginBottom: 8 }}>
              <h3>{d.name}{d.interestRate ? <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}> · {d.interestRate}% APR</span> : null}</h3>
              <span className="num neg" style={{ fontSize: 18 }}>{formatGBP(d.balance)}</span>
            </div>
            <div className="progress"><i className="ok" style={{ width: `${Math.min(progress, 100)}%` }} /></div>
            <div className="row-between" style={{ marginTop: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>{formatGBP(d.paidTotal)} repaid of {formatGBP(d.original)} ({progress}%)</span>
              <span className="muted" style={{ fontSize: 12 }}>
                {d.avgMonthly > 0 ? `${formatGBP(d.avgMonthly)}/mo · clear by ${payoffDate(d.projectedMonths)}` : "no payments logged"}
              </span>
            </div>
            <div className="toolbar" style={{ marginTop: 12 }}>
              <button className="btn-primary btn-sm" onClick={() => openPay(d)} disabled={cashAccounts.length === 0} title={cashAccounts.length === 0 ? "Add a cash account first (Manage)" : "Record a repayment"}>Record payment</button>
              <button className="btn-sm" onClick={() => openEdit(d)}>Edit</button>
              <button className="btn-danger btn-sm" onClick={() => askDelDebt(d)}>Delete</button>
            </div>
            {d.payments.length > 0 && (
              <table style={{ marginTop: 12 }}>
                <thead><tr><th>Date</th><th>Payment</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
                <tbody>
                  {d.payments.slice(0, 6).map((p) => (
                    <tr key={p.id}><td>{relativeDate(p.date)}</td><td>{p.name ?? "Repayment"}</td><td className="num pos">{formatGBP(p.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      {excludedDebts.length > 0 && (
        <div className="card">
          <h3 style={{ margin: "0 0 6px" }}>Excluded <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>· long-term, hidden from the plan above (still in net worth)</span></h3>
          {excludedDebts.map((d) => (
            <div className="lrow" key={d.id}>
              <span>{d.name}</span>
              <span><span className="num neg">{formatGBP(d.balance)}</span> <button className="btn-sm" style={{ marginLeft: 10 }} onClick={() => openEdit(d)}>Edit</button></span>
            </div>
          ))}
        </div>
      )}

      <Modal open={editOpen} onClose={() => setEditOpen(false)}>
        <form className="modal-body" onSubmit={(e) => { e.preventDefault(); if (form.name.trim()) saveDebt.mutate(); }}>
          <h3>{editId ? "Edit debt" : "Add debt"}</h3>
          <Field label="Who / what"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus placeholder="e.g. Loan from Dad, Mortgage" /></Field>
          <Field label="Amount owed (£)"><input inputMode="decimal" value={form.owed} onChange={(e) => setForm({ ...form, owed: e.target.value })} /></Field>
          <FieldRow>
            <Field label="Priority (lower = first)"><input inputMode="numeric" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} /></Field>
            <Field label="Planned payment (£)"><input inputMode="decimal" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} placeholder="partial ok" /></Field>
          </FieldRow>
          <Field label="Interest rate (% APR, optional)"><input inputMode="decimal" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="blank for interest-free" /></Field>
          <Toggle checked={form.excluded} onChange={(v) => setForm({ ...form, excluded: v })} label="Exclude from this screen (e.g. long-term mortgage)" />
          <div className="modal-actions"><button type="button" onClick={() => setEditOpen(false)}>Cancel</button><button className="btn-primary" type="submit">Save</button></div>
        </form>
      </Modal>

      <Modal open={payOpen} onClose={() => setPayOpen(false)}>
        <form className="modal-body" onSubmit={(e) => { e.preventDefault(); recordPayment.mutate(); }}>
          <h3>Record payment{payFor ? ` → ${payFor.name}` : ""}</h3>
          <FieldRow>
            <Field label="Amount (£)"><input inputMode="decimal" autoFocus value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} placeholder="0.00" /></Field>
            <Field label="Date"><input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></Field>
          </FieldRow>
          <Field label="Paid from">
            <select value={pay.accountId} onChange={(e) => setPay({ ...pay, accountId: e.target.value })}>
              {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
            </select>
          </Field>
          <p className="field-hint muted">Creates a repayment transaction linked to this debt and reduces the balance. For bank payments, link the synced transaction on Transactions instead (⛓).</p>
          <div className="modal-actions"><button type="button" onClick={() => setPayOpen(false)}>Cancel</button><button className="btn-primary" type="submit">Record</button></div>
        </form>
      </Modal>
    </div>
  );
}

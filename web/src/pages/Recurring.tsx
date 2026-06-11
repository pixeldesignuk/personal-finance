import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { Link } from "react-router-dom";
import { ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { api } from "../api.ts";
import type { RecurringScheduleDTO } from "../../../shared/types.ts";
import { formatGBP } from "../format.ts";
import { useToast } from "../components/Toasts.tsx";
import { Upcoming } from "../components/Upcoming.tsx";
import { PageHeader, Stat, EmptyState, Tabs, Modal, Field, FieldRow, type TabItem } from "../components/ui";

const TABS: TabItem[] = [{ key: "all", label: "All" }, { key: "bills", label: "Bills" }, { key: "income", label: "Income" }, { key: "ignored", label: "Stopped" }];
const dueLabel = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—");

export default function Recurring() {
  const qc = useQueryClient();
  const { notify } = useToast();
  const [tab, setTab] = useQueryState("tab", { defaultValue: "all", history: "replace" });
  const { data: schedules } = useQuery({ queryKey: ["recurring"], queryFn: () => api.recurring() });
  const { data: upcoming } = useQuery({ queryKey: ["upcoming"], queryFn: () => api.upcoming(30) });

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["recurring"] }); qc.invalidateQueries({ queryKey: ["upcoming"] }); };
  const patch = useMutation({
    mutationFn: ({ token, p }: { token: string; p: Parameters<typeof api.patchRecurring>[1] }) => api.patchRecurring(token, p),
    onSuccess: invalidate,
    onError: (e: Error) => notify(e.message, { tone: "error" }),
  });
  const detect = useMutation({
    mutationFn: () => api.detectRecurring(),
    onSuccess: (r) => { invalidate(); notify(`Detected ${r.detected} recurring payment${r.detected === 1 ? "" : "s"}`, { tone: "success" }); },
    onError: (e: Error) => notify(e.message, { tone: "error" }),
  });
  const create = useMutation({
    mutationFn: (input: Parameters<typeof api.createRecurring>[0]) => api.createRecurring(input),
    onSuccess: () => { invalidate(); notify("Added", { tone: "success" }); },
    onError: (e: Error) => notify(e.message, { tone: "error" }),
  });
  const reject = useMutation({
    mutationFn: (token: string) => api.notRecurring(token),
    onSuccess: () => { invalidate(); notify("Thanks — won't flag this as recurring again", { tone: "success" }); },
    onError: (e: Error) => notify(e.message, { tone: "error" }),
  });

  // Add-manual dialog (e.g. a salary detection missed).
  const [addOpen, setAddOpen] = useState(false);
  const [add, setAdd] = useState({ name: "", direction: "in" as "out" | "in", amount: "", dayOfMonth: "28" });
  const openAdd = () => { setAdd({ name: "", direction: "in", amount: "", dayOfMonth: "28" }); setAddOpen(true); };
  const submitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!add.name.trim() || !(Number(add.amount) > 0)) return;
    create.mutate({ name: add.name.trim(), direction: add.direction, amount: Number(add.amount), dayOfMonth: Math.min(31, Math.max(1, Number(add.dayOfMonth) || 1)) });
    setAddOpen(false);
  };

  const rows = schedules ?? [];
  const bills = useMemo(() => rows.filter((s) => s.direction === "out" && s.status !== "ignored"), [rows]);
  const income = useMemo(() => rows.filter((s) => s.direction === "in" && s.status !== "ignored"), [rows]);
  const billsMonthly = bills.reduce((s, r) => s + r.amount, 0);
  const incomeMonthly = income.reduce((s, r) => s + r.amount, 0);

  const shown = useMemo(() => {
    if (tab === "bills") return bills;
    if (tab === "income") return income;
    if (tab === "ignored") return rows.filter((s) => s.status === "ignored");
    return rows.filter((s) => s.status !== "ignored");
  }, [rows, tab, bills, income]);

  // Edit dialog.
  const [edit, setEdit] = useState<RecurringScheduleDTO | null>(null);
  const [form, setForm] = useState({ amount: "", dayOfMonth: "", cadence: "monthly", direction: "out" as "out" | "in" });
  const openEdit = (s: RecurringScheduleDTO) => { setEdit(s); setForm({ amount: String(s.amount), dayOfMonth: String(s.dayOfMonth ?? 1), cadence: s.cadence, direction: s.direction }); };
  const saveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    patch.mutate({ token: edit.token, p: { amount: Number(form.amount) || 0, dayOfMonth: Math.min(31, Math.max(1, Number(form.dayOfMonth) || 1)), cadence: form.cadence, direction: form.direction } });
    setEdit(null);
  };

  return (
    <div>
      <PageHeader
        title="Recurring"
        subtitle="Bills and income detected from your spending. Confirm the ones that are real so your safe-to-spend and Upcoming are accurate."
        actions={<>
          <button onClick={openAdd}>+ Add</button>
          <button className="btn-primary" onClick={() => detect.mutate()} disabled={detect.isPending}>{detect.isPending ? "Detecting…" : "Re-detect"}</button>
        </>}
      />

      <div className="grid">
        <Stat label="Bills / month" value={formatGBP(billsMonthly)} valueTone="neg" delta={`${bills.length} recurring`} />
        <Stat label="Income / month" value={formatGBP(incomeMonthly)} valueTone="pos" delta={`${income.length} source${income.length === 1 ? "" : "s"}`} />
        <Stat label="Net committed" value={formatGBP(incomeMonthly - billsMonthly)} valueTone={incomeMonthly - billsMonthly < 0 ? "neg" : "pos"} />
      </div>

      {upcoming && <Upcoming data={upcoming} limit={30} />}

      <Tabs value={tab} onChange={setTab} items={TABS} />

      {shown.length === 0 ? (
        <EmptyState>{rows.length === 0 ? "No recurring payments detected yet — hit Re-detect after a few months of synced data." : "Nothing in this view."}</EmptyState>
      ) : (
        <div className="card">
          {shown.map((s) => {
            const out = s.direction === "out";
            return (
              <div className="lrow recur-row" key={s.token}>
                <span className="recur-main">
                  <span className={`upcoming-ico ${out ? "out" : "in"}`}>{out ? <ArrowUpRight size={14} strokeWidth={2.2} /> : <ArrowDownLeft size={14} strokeWidth={2.2} />}</span>
                  <span className="recur-name">
                    <span className="td-clip">
                      {s.token.startsWith("income:") || s.token.startsWith("manual:")
                        ? s.name
                        : <Link className="amount-link" to={`/transactions?merchant=${encodeURIComponent(s.token)}`} title="View transactions">{s.name}</Link>}
                      {out && s.kind === "variable" && <span className="recur-tag" title="Amount varies month to month">variable</span>}
                      {s.prevAmount != null && (
                        <span className="recur-up" title={`Increased from ${formatGBP(s.prevAmount)}`}>↑ up from {formatGBP(s.prevAmount)}</span>
                      )}
                    </span>
                    <span className="muted recur-meta">{formatGBP(s.amount)} · {s.cadence}{s.dayOfMonth ? ` · day ${s.dayOfMonth}` : ""} · next {dueLabel(s.nextDue)}</span>
                  </span>
                </span>
                <span className="recur-actions">
                  {s.status === "auto" && <span className="badge warn" title="Auto-detected — confirm if real">unconfirmed</span>}
                  {s.status === "confirmed" && <span className="badge pos">confirmed</span>}
                  {s.status === "ignored" && <span className="badge" title="Hidden from Upcoming &amp; safe-to-spend">stopped</span>}
                  {s.status === "auto" && <button className="btn-sm btn-primary" onClick={() => patch.mutate({ token: s.token, p: { status: "confirmed" } })}>Confirm</button>}
                  <button className="btn-sm" onClick={() => openEdit(s)}>Edit</button>
                  {/* One negative action per row: an unconfirmed bill can be rejected as
                      "not recurring" (trains the detector); a confirmed item — which the
                      user already accepted as recurring — can only be hidden via "Stop
                      tracking"; a stopped item can be re-tracked. */}
                  {s.status === "ignored" ? (
                    <button className="btn-sm" onClick={() => patch.mutate({ token: s.token, p: { status: "auto" } })}>Track again</button>
                  ) : s.status === "auto" && s.direction === "out" ? (
                    <button className="btn-danger btn-sm" title="The detector got this wrong — it isn't a recurring payment. We'll stop flagging it." onClick={() => reject.mutate(s.token)}>Not recurring</button>
                  ) : (
                    <button className="btn-danger btn-sm" title="It is recurring, but hide it (e.g. cancelled) — keep it out of Upcoming &amp; safe-to-spend" onClick={() => patch.mutate({ token: s.token, p: { status: "ignored" } })}>Stop tracking</button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} size="sm">
        <form className="modal-body" onSubmit={submitAdd}>
          <h3>Add recurring</h3>
          <Field label="Name"><input value={add.name} autoFocus placeholder="e.g. Salary, Rent" onChange={(e) => setAdd({ ...add, name: e.target.value })} /></Field>
          <FieldRow>
            <Field label="Type">
              <select value={add.direction} onChange={(e) => setAdd({ ...add, direction: e.target.value as "out" | "in" })}>
                <option value="in">Income (in)</option><option value="out">Bill (out)</option>
              </select>
            </Field>
            <Field label="Amount (£)"><input inputMode="decimal" value={add.amount} placeholder="0.00" onChange={(e) => setAdd({ ...add, amount: e.target.value })} /></Field>
          </FieldRow>
          <Field label="Day of month" hint="Roughly when it lands — income tolerates a variable payday.">
            <input inputMode="numeric" value={add.dayOfMonth} onChange={(e) => setAdd({ ...add, dayOfMonth: e.target.value })} />
          </Field>
          <div className="modal-actions"><button type="button" onClick={() => setAddOpen(false)}>Cancel</button><button className="btn-primary" type="submit">Add</button></div>
        </form>
      </Modal>

      <Modal open={edit != null} onClose={() => setEdit(null)} size="sm">
        {edit && (
          <form className="modal-body" onSubmit={saveEdit}>
            <h3>Edit · {edit.name}</h3>
            <FieldRow>
              <Field label="Amount (£)"><input inputMode="decimal" value={form.amount} autoFocus onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
              <Field label="Day of month"><input inputMode="numeric" value={form.dayOfMonth} onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value })} /></Field>
            </FieldRow>
            <FieldRow>
              <Field label="Cadence">
                <select value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value })}>
                  <option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="yearly">Yearly</option><option value="irregular">Irregular</option>
                </select>
              </Field>
              <Field label="Direction">
                <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as "out" | "in" })}>
                  <option value="out">Bill (out)</option><option value="in">Income (in)</option>
                </select>
              </Field>
            </FieldRow>
            <div className="modal-actions"><button type="button" onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary" type="submit">Save</button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}

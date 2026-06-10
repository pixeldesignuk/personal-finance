import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { api } from "../api.ts";
import type { RecurringScheduleDTO } from "../../../shared/types.ts";
import { formatGBP } from "../format.ts";
import { useToast } from "../components/Toasts.tsx";
import { Upcoming } from "../components/Upcoming.tsx";
import { PageHeader, Stat, EmptyState, Tabs, Modal, Field, FieldRow, type TabItem } from "../components/ui";

const TABS: TabItem[] = [{ key: "all", label: "All" }, { key: "bills", label: "Bills" }, { key: "income", label: "Income" }, { key: "ignored", label: "Ignored" }];
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
        actions={<button onClick={() => detect.mutate()} disabled={detect.isPending}>{detect.isPending ? "Detecting…" : "Re-detect"}</button>}
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
                    <span className="td-clip">{s.name}</span>
                    <span className="muted recur-meta">{formatGBP(s.amount)} · {s.cadence}{s.dayOfMonth ? ` · day ${s.dayOfMonth}` : ""} · next {dueLabel(s.nextDue)}</span>
                  </span>
                </span>
                <span className="recur-actions">
                  {s.status === "auto" && <span className="badge warn" title="Auto-detected">unconfirmed</span>}
                  {s.status === "confirmed" && <span className="badge pos">confirmed</span>}
                  {s.status !== "ignored" && s.status === "auto" && <button className="btn-sm btn-primary" onClick={() => patch.mutate({ token: s.token, p: { status: "confirmed" } })}>Confirm</button>}
                  <button className="btn-sm" onClick={() => openEdit(s)}>Edit</button>
                  {s.status === "ignored"
                    ? <button className="btn-sm" onClick={() => patch.mutate({ token: s.token, p: { status: "auto" } })}>Restore</button>
                    : <button className="btn-danger btn-sm" onClick={() => patch.mutate({ token: s.token, p: { status: "ignored" } })}>Ignore</button>}
                </span>
              </div>
            );
          })}
        </div>
      )}

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

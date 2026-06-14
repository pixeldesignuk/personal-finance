import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryState } from "nuqs";
import { api } from "../api.ts";
import type { BudgetRowDTO, BudgetSummaryDTO, BillTargetDTO, CategoryInfoDTO } from "../../../shared/types.ts";
import { formatMoney } from "../format.ts";
import { PageHeader, Stat, EmptyState, Modal, Field, Toggle, useConfirm } from "../components/ui";

function nowMonth(): string {
  return new Date().toLocaleDateString("en-CA").slice(0, 7);
}
function barClass(percent: number): string {
  return percent > 100 ? "over" : percent >= 80 ? "warn" : "ok";
}

export default function Budgets() {
  const [month, setMonth] = useQueryState("month", { defaultValue: nowMonth(), history: "replace" });
  const [people, setPeople] = useState<{ key: string; name: string }[]>([]);
  const [person, setPerson] = useQueryState("person", { defaultValue: "", history: "replace" });
  const [rows, setRows] = useState<BudgetRowDTO[]>([]);
  const [billTargets, setBillTargets] = useState<BillTargetDTO[]>([]);
  const [summary, setSummary] = useState<BudgetSummaryDTO | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [hideEmpty, setHideEmpty] = useState(() => localStorage.getItem("budget.hideEmpty") === "1");
  const toggleHideEmpty = (v: boolean) => { localStorage.setItem("budget.hideEmpty", v ? "1" : "0"); setHideEmpty(v); };
  const confirm = useConfirm();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", group: "", monthlyAmount: "0" });

  useEffect(() => { api.people().then(setPeople).catch(() => setPeople([])); }, []);
  const load = () => api.budget(month, person || undefined).then((r) => { setRows(r.rows); setBillTargets(r.billTargets); setSummary(r.summary); setDraft({}); }).catch((e) => setMsg(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [month, person]);

  const groups = useMemo(() => {
    const seen: string[] = [];
    for (const r of rows) { const g = r.group ?? "Other"; if (!seen.includes(g)) seen.push(g); }
    return seen;
  }, [rows]);

  // Inline-edit a category's monthly budget.
  const commitAmount = async (r: BudgetRowDTO) => {
    const raw = draft[r.key];
    if (raw === undefined) return;
    const amount = Number(raw);
    if (Number.isNaN(amount) || amount === r.budgeted) { setDraft((d) => { const n = { ...d }; delete n[r.key]; return n; }); return; }
    try { await api.patchCategory(r.id, { monthlyAmount: amount }); await load(); } catch (e) { setMsg((e as Error).message); }
  };

  const wrap = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); setDialogOpen(false); } catch (e) { setMsg((e as Error).message); } };
  const [info, setInfo] = useState<CategoryInfoDTO | null>(null);
  const openNew = () => { setEditId(null); setInfo(null); setForm({ name: "", group: "", monthlyAmount: "0" }); setDialogOpen(true); };
  // Set every category's budget from spending history (median monthly spend).
  const autoPopulate = async () => {
    if (!(await confirm({
      title: "Auto-budget from history?",
      body: "This sets each category's monthly budget to your typical (median) spend over the months of history you have. It overwrites the current budget for categories you've spent in.",
      confirmLabel: "Set budgets",
    }))) return;
    try {
      const r = await api.autoPopulateBudget();
      await load();
      setMsg(r.months === 0
        ? "Not enough history yet — sync a full month first."
        : `Set ${r.updated} budget${r.updated === 1 ? "" : "s"} (${formatMoney(r.total)}/mo) from ${r.months} month${r.months === 1 ? "" : "s"} of history.`);
    } catch (e) { setMsg((e as Error).message); }
  };
  const openEdit = (r: BudgetRowDTO) => {
    setEditId(r.id); setForm({ name: r.name, group: r.group ?? "", monthlyAmount: String(r.budgeted) });
    setInfo(null);
    api.categoryInfo(r.key, month, person || undefined).then(setInfo).catch(() => setInfo(null));
    setDialogOpen(true);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setMsg("Enter a name"); return; }
    const monthlyAmount = Number(form.monthlyAmount) || 0;
    const group = form.group.trim() || null;
    if (editId == null) wrap(() => api.createCategory({ name: form.name.trim(), group, monthlyAmount }));
    else wrap(() => api.patchCategory(editId, { name: form.name.trim(), group, monthlyAmount }));
  };
  const archive = async (r: BudgetRowDTO) => {
    if (await confirm({ title: `Archive ${r.name}?`, body: "It'll be hidden from the budget. Existing transactions keep their category.", confirmLabel: "Archive", danger: true })) {
      try { await api.patchCategory(r.id, { archived: true }); await load(); } catch (e) { setMsg((e as Error).message); }
    }
  };

  return (
    <div>
      <PageHeader
        title="Budget"
        actions={<>
          <select value={person} onChange={(e) => setPerson(e.target.value || null)}>
            <option value="">Everyone</option>
            <option value="none">Unassigned</option>
            {people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: "auto" }} />
          <Toggle checked={hideEmpty} onChange={toggleHideEmpty} label="Hide empty" title="Hide categories with no budget and no spend" />
          <button onClick={autoPopulate} title="Set budgets automatically from your spending history">Auto-budget</button>
          <Link to="/budgets/v2" className="btn-sm">Try v2 →</Link>
          <button className="btn-primary" onClick={openNew}>Add category</button>
        </>}
      />
      {msg && <p className="muted">{msg}</p>}
      {summary && (
        <div className="grid">
          <Stat
            label="Available to budget"
            value={`${summary.available < 0 ? "-" : ""}£${formatMoney(Math.abs(summary.available))}`}
            valueTone={summary.available < 0 ? "neg" : "pos"}
          />
          <Stat
            label="Spent this month"
            value={`£${formatMoney(summary.spent)}`}
            {...(() => {
              const d = summary.spent - summary.spentLastMonth;
              if (Math.abs(d) < 0.005) return { delta: "— vs last month" as const };
              const up = d > 0;
              const pct = summary.spentLastMonth > 0 ? ` (${Math.round((Math.abs(d) / summary.spentLastMonth) * 100)}%)` : "";
              return { delta: `${up ? "↑" : "↓"} £${formatMoney(Math.abs(d))}${pct} vs last month`, deltaTone: (up ? "neg" : "pos") as "neg" | "pos" };
            })()}
          />
          <Stat label="Budgeted this month" value={`£${formatMoney(summary.budgeted)}`} />
          {summary.setAside > 0
            ? <Stat label="Set aside for bills" value={`£${formatMoney(summary.setAside)}`} delta="quarterly & annual" />
            : <Stat label="Pending transactions" value={summary.pendingCount} />}
        </div>
      )}

      {billTargets.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h3>Bills you're saving for</h3>
            <span className="muted" style={{ fontSize: 13 }}>£{formatMoney(billTargets.reduce((s, t) => s + t.monthlyAmount, 0))} / mo</span>
          </div>
          <p className="muted" style={{ marginTop: -4, fontSize: 13 }}>Quarterly & annual bills, spread across the months so they never spike. We reserve the monthly amount from your “available to budget”.</p>
          <div className="bill-targets">
            {billTargets.map((t) => {
              const pct = Math.min(100, Math.round((t.monthsElapsed / t.periodMonths) * 100));
              const due = t.nextDue ? new Date(`${t.nextDue}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
              return (
                <div className="bill-target" key={t.token}>
                  <div className="bill-target-top">
                    <span className="bill-target-name td-clip">{t.name}</span>
                    <span className="num"><strong>£{formatMoney(t.monthlyAmount)}</strong> <span className="muted">/ mo</span></span>
                  </div>
                  <div className="progress"><i className="ok" style={{ width: `${pct}%` }} /></div>
                  <div className="bill-target-meta muted">
                    <span>£{formatMoney(t.setAside)} set aside of £{formatMoney(t.amount)} · {t.monthsElapsed} of {t.periodMonths}</span>
                    <span>{t.cadence === "yearly" ? "Annual" : "Quarterly"} · due {due}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {rows.length === 0 && <EmptyState>No categories yet — add one above.</EmptyState>}
      {groups.map((g) => {
        const gr = rows.filter((r) => (r.group ?? "Other") === g && (!hideEmpty || r.budgeted > 0 || r.spent > 0));
        if (gr.length === 0) return null;
        const gBudget = gr.reduce((s, r) => s + r.budgeted, 0);
        const gSpent = gr.reduce((s, r) => s + r.spent, 0);
        const gPct = gBudget > 0 ? Math.round((gSpent / gBudget) * 100) : (gSpent > 0 ? 100 : 0);
        const gTone = gSpent > gBudget ? "neg" : gPct >= 80 ? "warn-text" : "muted";
        return (
          <div className="card" key={g}>
            <div className="card-head">
              <h3>{g}</h3>
              <span className={`num ${gTone}`} style={{ fontSize: 13 }}>£{formatMoney(gSpent)} / £{formatMoney(gBudget)} · {gPct}%</span>
            </div>
            <table className="budget-table">
              <colgroup><col /><col style={{ width: 120 }} /><col style={{ width: 110 }} /><col style={{ width: 110 }} /><col style={{ width: 96 }} /></colgroup>
              <thead><tr><th>Category</th><th>Budget</th><th>Spent</th><th>Left</th><th></th></tr></thead>
              <tbody>
                {gr.map((r) => (
                  <tr key={r.key}>
                    <td>
                      {r.name}
                      {r.budgeted === 0 && r.spent > 0 && <span className="badge warn" style={{ marginLeft: 8 }} title="Spending with no budget set">no budget</span>}
                      <div className="progress" style={{ marginTop: 6 }}><i className={barClass(r.percent)} style={{ width: `${Math.min(r.percent, 100)}%` }} /></div>
                    </td>
                    <td>
                      <div className="budget-input">
                        <span>£</span>
                        <input
                          inputMode="decimal"
                          value={draft[r.key] ?? String(r.budgeted)}
                          onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value }))}
                          onBlur={() => commitAmount(r)}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                        />
                      </div>
                    </td>
                    <td className="num">
                      {r.spent > 0
                        ? <Link className="amount-link" to={`/transactions?category=${encodeURIComponent(r.key)}${month ? `&month=${month}` : ""}${person ? `&person=${encodeURIComponent(person)}` : ""}`} title="View these transactions">£{formatMoney(r.spent)}</Link>
                        : <>£{formatMoney(r.spent)}</>}
                    </td>
                    <td className={`num ${r.left < 0 ? "neg" : "pos"}`}>£{formatMoney(r.left)}</td>
                    <td className="row-actions">
                      <button className="btn-sm" onClick={() => openEdit(r)}>Edit</button>
                      <button className="btn-danger btn-sm" onClick={() => archive(r)}>Archive</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      <Modal open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <form className="modal-body" onSubmit={submit}>
          <h3>{editId == null ? "New category" : "Edit category"}</h3>
          <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
          <Field label="Group">
            <input list="budget-groups" value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })} placeholder="e.g. Monthly Bills" />
            <datalist id="budget-groups">{groups.filter((g) => g !== "Other").map((g) => <option key={g} value={g} />)}</datalist>
          </Field>
          <Field label="Monthly budget (£)"><input inputMode="decimal" value={form.monthlyAmount} onChange={(e) => setForm({ ...form, monthlyAmount: e.target.value })} /></Field>
          {editId != null && info && (
            <div className="catinfo">
              <div className="catinfo-head">Category information</div>
              <div className="catinfo-row"><span>Carried forward</span><span className={`num ${info.carriedForward < 0 ? "neg" : ""}`}>£{formatMoney(info.carriedForward)}</span></div>
              <div className="catinfo-row"><span>Spent last month</span><span className="num">£{formatMoney(info.spentLastMonth)}</span></div>
              <div className="catinfo-row"><span>Budgeted last month</span><span className="num">£{formatMoney(info.budgetedLastMonth)}</span></div>
              <div className="catinfo-row"><span>Monthly amount</span><span className="num" style={{ color: "var(--jade)" }}>£{formatMoney(info.monthlyAmount)}</span></div>
              <div className="catinfo-row"><span>Goal amount</span><span className="num muted">{info.goalAmount == null ? "N/A" : `£${formatMoney(info.goalAmount)}`}</span></div>
            </div>
          )}
          <div className="modal-actions"><button type="button" onClick={() => setDialogOpen(false)}>Cancel</button><button className="btn-primary" type="submit">Save</button></div>
        </form>
      </Modal>
    </div>
  );
}

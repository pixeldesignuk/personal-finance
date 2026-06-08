import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.ts";
import type { BudgetRowDTO, BudgetSummaryDTO, CategoryInfoDTO } from "../../../shared/types.ts";
import { formatMoney } from "../format.ts";

function nowMonth(): string {
  return new Date().toLocaleDateString("en-CA").slice(0, 7);
}
function barClass(percent: number): string {
  return percent > 100 ? "over" : percent >= 80 ? "warn" : "ok";
}

export default function Budgets() {
  const [month, setMonth] = useState(nowMonth());
  const [people, setPeople] = useState<{ key: string; name: string }[]>([]);
  const [person, setPerson] = useState("");
  const [rows, setRows] = useState<BudgetRowDTO[]>([]);
  const [summary, setSummary] = useState<BudgetSummaryDTO | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const dialog = useRef<HTMLDialogElement>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", group: "", monthlyAmount: "0" });

  useEffect(() => { api.people().then(setPeople).catch(() => setPeople([])); }, []);
  const load = () => api.budget(month, person || undefined).then((r) => { setRows(r.rows); setSummary(r.summary); setDraft({}); }).catch((e) => setMsg(e.message));
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

  const wrap = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); dialog.current?.close(); } catch (e) { setMsg((e as Error).message); } };
  const [info, setInfo] = useState<CategoryInfoDTO | null>(null);
  const openNew = () => { setEditId(null); setInfo(null); setForm({ name: "", group: "", monthlyAmount: "0" }); dialog.current?.showModal(); };
  const openEdit = (r: BudgetRowDTO) => {
    setEditId(r.id); setForm({ name: r.name, group: r.group ?? "", monthlyAmount: String(r.budgeted) });
    setInfo(null);
    api.categoryInfo(r.key, month, person || undefined).then(setInfo).catch(() => setInfo(null));
    dialog.current?.showModal();
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setMsg("Enter a name"); return; }
    const monthlyAmount = Number(form.monthlyAmount) || 0;
    const group = form.group.trim() || null;
    if (editId == null) wrap(() => api.createCategory({ name: form.name.trim(), group, monthlyAmount }));
    else wrap(() => api.patchCategory(editId, { name: form.name.trim(), group, monthlyAmount }));
  };
  const archive = (id: number) => { if (window.confirm("Archive this category?")) wrap(() => api.patchCategory(id, { archived: true })); };

  return (
    <div>
      <div className="row-between">
        <h1>Budget</h1>
        <div className="toolbar">
          <select value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">Everyone</option>
            <option value="none">Unassigned</option>
            {people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: "auto" }} />
          <button className="btn-primary" onClick={openNew}>Add category</button>
        </div>
      </div>
      {msg && <p className="muted">{msg}</p>}
      {summary && (
        <div className="grid">
          <div className="card stat">
            <span className="label">Available to budget</span>
            <span className={`value ${summary.available < 0 ? "neg" : "pos"}`}>{summary.available < 0 ? "-" : ""}£{formatMoney(Math.abs(summary.available))}</span>
          </div>
          <div className="card stat">
            <span className="label">Spent this month</span>
            <span className="value">£{formatMoney(summary.spent)}</span>
            {(() => {
              const d = summary.spent - summary.spentLastMonth;
              if (Math.abs(d) < 0.005) return <span className="delta muted">— vs last month</span>;
              const up = d > 0;
              const pct = summary.spentLastMonth > 0 ? ` (${Math.round((Math.abs(d) / summary.spentLastMonth) * 100)}%)` : "";
              return <span className={`delta ${up ? "neg" : "pos"}`}>{up ? "↑" : "↓"} £{formatMoney(Math.abs(d))}{pct} vs last month</span>;
            })()}
          </div>
          <div className="card stat"><span className="label">Budgeted this month</span><span className="value">£{formatMoney(summary.budgeted)}</span></div>
          <div className="card stat"><span className="label">Pending transactions</span><span className="value">{summary.pendingCount}</span></div>
        </div>
      )}
      {rows.length === 0 && <div className="card"><p className="muted">No categories yet — add one above.</p></div>}
      {groups.map((g) => {
        const gr = rows.filter((r) => (r.group ?? "Other") === g);
        const gBudget = gr.reduce((s, r) => s + r.budgeted, 0);
        const gSpent = gr.reduce((s, r) => s + r.spent, 0);
        return (
          <div className="card" key={g}>
            <div className="row-between" style={{ marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>{g}</h3>
              <span className="num muted">£{formatMoney(gSpent)} spent / £{formatMoney(gBudget)} · £{formatMoney(gBudget - gSpent)} left</span>
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
                        ? <Link className="amount-link" to={`/transactions?category=${encodeURIComponent(r.key)}`} title="View these transactions">£{formatMoney(r.spent)}</Link>
                        : <>£{formatMoney(r.spent)}</>}
                    </td>
                    <td className={`num ${r.left < 0 ? "neg" : "pos"}`}>£{formatMoney(r.left)}</td>
                    <td style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button className="btn-sm" onClick={() => openEdit(r)}>Edit</button>
                      <button className="btn-danger btn-sm" onClick={() => archive(r.id)}>Archive</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      <dialog ref={dialog} className="modal" onClick={(e) => { if (e.target === dialog.current) dialog.current?.close(); }}>
        <form className="modal-body" onSubmit={submit}>
          <h3 style={{ marginTop: 0 }}>{editId == null ? "New category" : "Edit category"}</h3>
          <label className="field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></label>
          <label className="field"><span>Group</span>
            <input list="budget-groups" value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })} placeholder="e.g. Monthly Bills" />
            <datalist id="budget-groups">{groups.filter((g) => g !== "Other").map((g) => <option key={g} value={g} />)}</datalist>
          </label>
          <label className="field"><span>Monthly budget (£)</span><input inputMode="decimal" value={form.monthlyAmount} onChange={(e) => setForm({ ...form, monthlyAmount: e.target.value })} /></label>
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
          <div className="modal-actions"><button type="button" onClick={() => dialog.current?.close()}>Cancel</button><button className="btn-primary" type="submit">Save</button></div>
        </form>
      </dialog>
    </div>
  );
}

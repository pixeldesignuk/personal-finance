import { useEffect, useMemo, useState } from "react";
import { Home } from "lucide-react";
import { api } from "../api.ts";
import type { BankDTO, AccountDTO } from "../../../shared/types.ts";
import { formatGBP, formatMoney } from "../format.ts";
import { CardMenu } from "../components/CardMenu.tsx";
import { PageHeader, Stat, EmptyState, Modal, Field, useConfirm } from "../components/ui";

const numOk = (s: string) => /^-?\d+(\.\d+)?$/.test(s.trim());

export default function Assets() {
  const [banks, setBanks] = useState<BankDTO[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const confirm = useConfirm();
  const load = () => api.accounts().then(setBanks).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  const wrap = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); } catch (e) { setMsg((e as Error).message); } };

  const assets = useMemo(() => banks.find((b) => b.status === "ASSET")?.accounts ?? [], [banks]);
  const total = useMemo(() => assets.reduce((s, a) => s + a.currentBalance, 0), [assets]);

  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", value: "0" });
  const openAdd = () => { setAddForm({ name: "", value: "0" }); setAddOpen(true); };
  const submitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.name.trim()) { setMsg("Enter a name"); return; }
    wrap(async () => { await api.createManualAccount({ name: addForm.name.trim(), type: "PERSONAL", source: "ASSET", manualBalance: numOk(addForm.value) ? addForm.value.trim() : "0" }); setAddOpen(false); });
  };

  const [edit, setEdit] = useState<{ kind: "rename" | "value"; id: string; label: string } | null>(null);
  const [editVal, setEditVal] = useState("");
  const openRename = (a: AccountDTO) => { setEdit({ kind: "rename", id: a.id, label: a.displayName }); setEditVal(a.nickname ?? ""); };
  const openValue = (a: AccountDTO) => { setEdit({ kind: "value", id: a.id, label: a.displayName }); setEditVal(String(a.currentBalance)); };
  const submitEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    if (edit.kind === "rename") wrap(() => api.patchAccount(edit.id, { nickname: editVal.trim() || null }));
    else wrap(() => api.patchAccount(edit.id, { manualBalance: numOk(editVal) ? editVal.trim() : "0" }));
    setEdit(null);
  };

  const askDel = async (a: AccountDTO) => {
    if (await confirm({ title: `Delete ${a.displayName}?`, body: "This removes the asset from your net worth.", danger: true })) {
      wrap(() => api.deleteManualAccount(a.id));
    }
  };

  return (
    <div>
      <PageHeader
        title="Assets"
        subtitle="Things you own — house, car, valuables. Counts toward net worth (if enabled). Any mortgage/loan is tracked separately under Debt."
        actions={<button className="btn-primary" onClick={openAdd}>Add asset</button>}
      />
      {msg && <p className="muted">{msg}</p>}

      <div className="grid">
        <Stat label="Total assets" value={formatGBP(total)} delta={`${assets.length} item${assets.length === 1 ? "" : "s"}`} />
      </div>

      {assets.length === 0 && <EmptyState>No assets yet.</EmptyState>}
      <div className="grid acct-cards">
        {assets.map((a) => (
          <div className="card acct-card" key={a.id}>
            <div className="acct-card-meta">
              <span className="acct-inst-wrap">
                <span className="acct-cash-ico asset"><Home size={13} strokeWidth={2} /></span>
                <span className="acct-inst">Asset</span>
              </span>
              <CardMenu>
                <button type="button" onClick={() => openRename(a)}>Rename</button>
                <button type="button" onClick={() => openValue(a)}>Set value</button>
                <button type="button" className="danger" onClick={() => askDel(a)}>Delete</button>
              </CardMenu>
            </div>
            <div className="acct-card-head"><span className="acct-name">{a.displayName}</span></div>
            <div className="acct-card-figure">
              <span className="eyebrow acct-card-label">Value</span>
              <span className="acct-card-bal"><span className="ccy">{a.currency ?? "GBP"}</span> {formatMoney(a.currentBalance)}</span>
            </div>
          </div>
        ))}
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)}>
        <form className="modal-body" onSubmit={submitAdd}>
          <h3>Add asset</h3>
          <Field label="Name"><input value={addForm.name} autoFocus placeholder="e.g. House, Car" onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} /></Field>
          <Field label="Current value (£)"><input inputMode="decimal" value={addForm.value} onChange={(e) => setAddForm({ ...addForm, value: e.target.value })} /></Field>
          <div className="modal-actions"><button type="button" onClick={() => setAddOpen(false)}>Cancel</button><button className="btn-primary" type="submit">Add</button></div>
        </form>
      </Modal>

      <Modal open={edit != null} onClose={() => setEdit(null)} size="sm">
        {edit && (
          <form className="modal-body" onSubmit={submitEdit}>
            <h3>{edit.kind === "rename" ? "Rename" : "Set value"} · {edit.label}</h3>
            <Field label={edit.kind === "rename" ? "Nickname (blank to clear)" : "Value (£)"}>
              <input value={editVal} autoFocus inputMode={edit.kind === "value" ? "decimal" : undefined} onChange={(e) => setEditVal(e.target.value)} />
            </Field>
            <div className="modal-actions"><button type="button" onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary" type="submit">Save</button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}

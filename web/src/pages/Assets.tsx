import { useEffect, useMemo, useRef, useState } from "react";
import { Home } from "lucide-react";
import { api } from "../api.ts";
import type { BankDTO, AccountDTO } from "../../../shared/types.ts";
import { formatGBP, formatMoney } from "../format.ts";
import { CardMenu } from "../components/CardMenu.tsx";

const numOk = (s: string) => /^-?\d+(\.\d+)?$/.test(s.trim());

export default function Assets() {
  const [banks, setBanks] = useState<BankDTO[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => api.accounts().then(setBanks).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  const wrap = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); } catch (e) { setMsg((e as Error).message); } };

  const assets = useMemo(() => banks.find((b) => b.status === "ASSET")?.accounts ?? [], [banks]);
  const total = useMemo(() => assets.reduce((s, a) => s + a.currentBalance, 0), [assets]);

  const addDialog = useRef<HTMLDialogElement>(null);
  const [addForm, setAddForm] = useState({ name: "", value: "0" });
  const openAdd = () => { setAddForm({ name: "", value: "0" }); addDialog.current?.showModal(); };
  const submitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.name.trim()) { setMsg("Enter a name"); return; }
    wrap(async () => { await api.createManualAccount({ name: addForm.name.trim(), type: "PERSONAL", source: "ASSET", manualBalance: numOk(addForm.value) ? addForm.value.trim() : "0" }); addDialog.current?.close(); });
  };

  const editDialog = useRef<HTMLDialogElement>(null);
  const [edit, setEdit] = useState<{ kind: "rename" | "value"; id: string; label: string } | null>(null);
  const [editVal, setEditVal] = useState("");
  const openRename = (a: AccountDTO) => { setEdit({ kind: "rename", id: a.id, label: a.displayName }); setEditVal(a.nickname ?? ""); editDialog.current?.showModal(); };
  const openValue = (a: AccountDTO) => { setEdit({ kind: "value", id: a.id, label: a.displayName }); setEditVal(String(a.currentBalance)); editDialog.current?.showModal(); };
  const submitEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    if (edit.kind === "rename") wrap(() => api.patchAccount(edit.id, { nickname: editVal.trim() || null }));
    else wrap(() => api.patchAccount(edit.id, { manualBalance: numOk(editVal) ? editVal.trim() : "0" }));
    editDialog.current?.close();
  };

  const confirmDialog = useRef<HTMLDialogElement>(null);
  const [del, setDel] = useState<AccountDTO | null>(null);
  const askDel = (a: AccountDTO) => { setDel(a); confirmDialog.current?.showModal(); };

  return (
    <div>
      <div className="row-between">
        <h1>Assets</h1>
        <button className="btn-primary" onClick={openAdd}>Add asset</button>
      </div>
      <p className="muted" style={{ marginTop: -6 }}>Things you own — house, car, valuables. Counts toward net worth (if enabled). Any mortgage/loan is tracked separately under Debt.</p>
      {msg && <p className="muted">{msg}</p>}

      <div className="grid">
        <div className="card stat"><span className="label">Total assets</span><span className="value">{formatGBP(total)}</span><span className="delta muted">{assets.length} item{assets.length === 1 ? "" : "s"}</span></div>
      </div>

      {assets.length === 0 && <div className="card"><p className="muted">No assets yet.</p></div>}
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

      <dialog ref={addDialog} className="modal" onClick={(e) => { if (e.target === addDialog.current) addDialog.current?.close(); }}>
        <form className="modal-body" onSubmit={submitAdd}>
          <h3 style={{ marginTop: 0 }}>Add asset</h3>
          <label className="field"><span>Name</span><input value={addForm.name} autoFocus placeholder="e.g. House, Car" onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} /></label>
          <label className="field"><span>Current value (£)</span><input inputMode="decimal" value={addForm.value} onChange={(e) => setAddForm({ ...addForm, value: e.target.value })} /></label>
          <div className="modal-actions"><button type="button" onClick={() => addDialog.current?.close()}>Cancel</button><button className="btn-primary" type="submit">Add</button></div>
        </form>
      </dialog>

      <dialog ref={editDialog} className="modal" onClick={(e) => { if (e.target === editDialog.current) editDialog.current?.close(); }}>
        {edit && (
          <form className="modal-body" onSubmit={submitEdit}>
            <h3 style={{ marginTop: 0 }}>{edit.kind === "rename" ? "Rename" : "Set value"} · {edit.label}</h3>
            <label className="field">
              <span>{edit.kind === "rename" ? "Nickname (blank to clear)" : "Value (£)"}</span>
              <input value={editVal} autoFocus inputMode={edit.kind === "value" ? "decimal" : undefined} onChange={(e) => setEditVal(e.target.value)} />
            </label>
            <div className="modal-actions"><button type="button" onClick={() => editDialog.current?.close()}>Cancel</button><button className="btn-primary" type="submit">Save</button></div>
          </form>
        )}
      </dialog>

      <dialog ref={confirmDialog} className="modal" onClick={(e) => { if (e.target === confirmDialog.current) confirmDialog.current?.close(); }}>
        {del && (
          <div className="modal-body">
            <h3 style={{ marginTop: 0 }}>Delete {del.displayName}?</h3>
            <p className="muted">This removes the asset from your net worth.</p>
            <div className="modal-actions"><button type="button" onClick={() => confirmDialog.current?.close()}>Cancel</button><button className="btn-danger" onClick={() => { wrap(() => api.deleteManualAccount(del.id)); confirmDialog.current?.close(); }}>Delete</button></div>
          </div>
        )}
      </dialog>
    </div>
  );
}

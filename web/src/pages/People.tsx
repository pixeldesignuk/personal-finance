import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { PersonDTO } from "../../../shared/types.ts";
import { PageHeader, EmptyState, Modal, Field, useConfirm } from "../components/ui";

export default function People() {
  const [people, setPeople] = useState<PersonDTO[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const confirm = useConfirm();
  const load = () => api.people().then(setPeople).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  const wrap = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); } catch (e) { setMsg((e as Error).message); } };

  // Add / rename dialog (replaces window.prompt).
  const [editing, setEditing] = useState<{ id: number | null; name: string } | null>(null);
  const openAdd = () => setEditing({ id: null, name: "" });
  const openRename = (p: PersonDTO) => setEditing({ id: p.id, name: p.name });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) return;
    if (editing.id == null) wrap(() => api.createPerson(name));
    else wrap(() => api.patchPerson(editing.id as number, { name }));
    setEditing(null);
  };

  const archive = async (p: PersonDTO) => {
    if (await confirm({ title: `Archive ${p.name}?`, body: "They'll no longer appear in pickers. Existing transactions keep their assignment.", confirmLabel: "Archive", danger: true })) {
      wrap(() => api.patchPerson(p.id, { archived: true }));
    }
  };

  return (
    <div>
      <PageHeader title="People" actions={<button className="btn-primary" onClick={openAdd}>Add person</button>} />
      {msg && <p className="muted">{msg}</p>}
      {people.length === 0 ? (
        <EmptyState>No people yet — add someone to split spending by.</EmptyState>
      ) : (
        <div className="card">
          <table>
            <thead><tr><th>Name</th><th>Key</th><th></th></tr></thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td><td className="muted">{p.key}</td>
                  <td className="row-actions">
                    <button className="btn-sm" onClick={() => openRename(p)}>Rename</button>
                    <button className="btn-danger btn-sm" onClick={() => archive(p)}>Archive</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={editing != null} onClose={() => setEditing(null)} size="sm">
        {editing && (
          <form className="modal-body" onSubmit={submit}>
            <h3>{editing.id == null ? "Add person" : "Rename person"}</h3>
            <Field label="Name">
              <input value={editing.name} autoFocus placeholder="e.g. Maryam" onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <div className="modal-actions">
              <button type="button" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary" type="submit">{editing.id == null ? "Add" : "Save"}</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { PersonDTO } from "../../../shared/types.ts";

export default function People() {
  const [people, setPeople] = useState<PersonDTO[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => api.people().then(setPeople).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  const wrap = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); } catch (e) { setMsg((e as Error).message); } };
  const add = () => { const n = window.prompt("Person name:"); if (n) wrap(() => api.createPerson(n)); };
  const rename = (id: number, cur: string) => { const n = window.prompt("Rename:", cur); if (n && n !== cur) wrap(() => api.patchPerson(id, { name: n })); };
  const archive = (id: number) => { if (window.confirm("Archive this person?")) wrap(() => api.patchPerson(id, { archived: true })); };
  return (
    <div>
      <div className="row-between"><h1>People</h1><button className="btn-primary" onClick={add}>Add person</button></div>
      {msg && <p className="muted">{msg}</p>}
      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>Key</th><th></th></tr></thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td><td className="muted">{p.key}</td>
                <td style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button className="btn-sm" onClick={() => rename(p.id, p.name)}>Rename</button>
                  <button className="btn-danger btn-sm" onClick={() => archive(p.id)}>Archive</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

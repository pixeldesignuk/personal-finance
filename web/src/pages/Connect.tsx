import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { InstitutionDTO } from "../../../shared/types.ts";

export default function Connect() {
  const [list, setList] = useState<InstitutionDTO[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.institutions().then(setList).catch((e) => setError(e.message));
  }, []);

  const choose = async (id: string) => {
    try {
      const { link } = await api.connect(id);
      window.location.href = link;
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const filtered = list.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <h1>Connect a bank</h1>
      <p className="muted" style={{ marginTop: "-0.4em" }}>Pick your bank, authenticate, and we'll pull balances &amp; transactions.</p>
      {error && <p className="neg">{error}</p>}
      <input placeholder="Search banks…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360 }} />
      <div className="card" style={{ marginTop: 16 }}>
        {filtered.map((i) => (
          <div key={i.id} className="lrow">
            <span>{i.name}</span>
            <button className="btn-primary btn-sm" onClick={() => choose(i.id)}>Connect</button>
          </div>
        ))}
      </div>
    </div>
  );
}

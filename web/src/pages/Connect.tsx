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
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <input placeholder="Search banks..." value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card" style={{ marginTop: 16 }}>
        {filtered.map((i) => (
          <div key={i.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
            <span>{i.name}</span>
            <button onClick={() => choose(i.id)}>Connect</button>
          </div>
        ))}
      </div>
    </div>
  );
}

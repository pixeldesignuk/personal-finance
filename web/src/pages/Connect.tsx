import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { InstitutionDTO } from "../../../shared/types.ts";
import { BrandLogo } from "../components/BrandLogo.tsx";
import { PageHeader } from "../components/ui";

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
      <PageHeader title="Connect a bank" subtitle="Pick your bank, authenticate, and we'll pull balances & transactions." />
      {error && <p className="neg">{error}</p>}
      <input className="search-input" placeholder="Search banks…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card">
        {filtered.map((i) => (
          <div key={i.id} className="lrow">
            <span className="lrow-acct">
              <BrandLogo name={i.name} src={i.logo} size={24} />
              <span>{i.name}</span>
            </span>
            <button className="btn-primary btn-sm" onClick={() => choose(i.id)}>Connect</button>
          </div>
        ))}
        {filtered.length === 0 && <p className="empty">No banks match “{q}”.</p>}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.ts";

export default function Callback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState("Finalising connection…");

  useEffect(() => {
    const ref = params.get("ref");
    if (!ref) { setStatus("Missing requisition reference."); return; }
    fetch(`/api/connect/by-ref/${encodeURIComponent(ref)}`)
      .then((r) => r.json())
      .then(({ id }) => api.finalize(id))
      .then((r) => {
        setStatus(r.rateLimited
          ? `Connected ${r.accounts} account(s). Your bank's daily refresh limit was reached, so transactions will fill in on the next sync.`
          : `Connected ${r.accounts} account(s).`);
        setTimeout(() => navigate("/"), r.rateLimited ? 3500 : 1200);
      })
      .catch((e) => setStatus(`Error: ${e.message}`));
  }, [params, navigate]);

  return (
    <div className="card card-centered">
      <h1>Bank connection</h1>
      <p className="muted">{status}</p>
    </div>
  );
}

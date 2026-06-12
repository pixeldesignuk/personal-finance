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
    let cancelled = false;
    (async () => {
      try {
        const { id } = await fetch(`/api/connect/by-ref/${encodeURIComponent(ref)}`).then((r) => r.json());
        // Linking is fast and returns immediately.
        const r = await api.finalize(id);
        if (cancelled) return;
        setStatus(`Connected ${r.accounts} account${r.accounts === 1 ? "" : "s"}. Importing your history…`);
        // The full-history import (up to ~2 years on a reconnect) streams its
        // progress, so the long pull never trips a request timeout. Surface the
        // latest audit line as status as it arrives.
        await api.finalizeSyncStream(id, (e) => {
          if (!cancelled && e.kind === "log" && e.text) setStatus(e.text.trim());
        });
        if (cancelled) return;
        setTimeout(() => navigate("/"), 1200);
      } catch (e) {
        if (!cancelled) setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return () => { cancelled = true; };
  }, [params, navigate]);

  return (
    <div className="card card-centered">
      <h1>Bank connection</h1>
      <p className="muted">{status}</p>
    </div>
  );
}

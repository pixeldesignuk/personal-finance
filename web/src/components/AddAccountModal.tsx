import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Landmark, Wallet, LineChart } from "lucide-react";
import { api } from "../api.ts";
import { INVESTMENT_PROVIDER_FORMS, providerForm, providerLogoCandidates, INVESTMENT_PROVIDERS } from "../../../shared/investmentMeta.ts";
import { Modal, Field } from "./ui";
import { BrandLogo } from "./BrandLogo.tsx";

type Step = "choose" | "cash" | "investment";

// One "Add account" entry that branches: connect a bank (→ /connect), add a cash
// account, or connect an investment provider (Trading 212 / Bitget) by entering
// API keys. onAdded fires after a cash/investment account is created so the caller
// can refresh.
export function AddAccountModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("choose");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Cash form
  const [cash, setCash] = useState<{ name: string; value: string; type: "PERSONAL" | "BUSINESS" }>({ name: "", value: "0", type: "PERSONAL" });
  // Investment form
  const [provider, setProvider] = useState<string | null>(null);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [invName, setInvName] = useState("");

  const reset = () => { setStep("choose"); setErr(null); setBusy(false); setProvider(null); setConfig({}); setInvName(""); setCash({ name: "", value: "0", type: "PERSONAL" }); };
  const close = () => { reset(); onClose(); };
  const done = () => { reset(); onAdded(); onClose(); };

  const submitCash = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cash.name.trim()) { setErr("Enter a name"); return; }
    const value = /^-?\d+(\.\d+)?$/.test(cash.value.trim()) ? cash.value.trim() : "0";
    setBusy(true); setErr(null);
    try { await api.createManualAccount({ name: cash.name.trim(), type: cash.type, source: "MANUAL", manualBalance: value }); done(); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  const submitInvestment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!provider) return;
    setBusy(true); setErr(null);
    try { await api.connectInvestment(provider, config, invName.trim() || undefined); done(); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  const form = providerForm(provider);

  return (
    <Modal open={open} onClose={close} size={step === "choose" ? undefined : "sm"}>
      <div className="modal-body">
        {step === "choose" && (
          <>
            <h3>Add account</h3>
            <div className="addacct-tiles">
              <button type="button" className="addacct-tile" onClick={() => { close(); navigate("/connect"); }}>
                <span className="addacct-ico"><Landmark size={22} strokeWidth={1.8} /></span>
                <span className="addacct-tname">Bank</span>
                <span className="addacct-tsub">Connect via open banking</span>
              </button>
              <button type="button" className="addacct-tile" onClick={() => { setErr(null); setStep("cash"); }}>
                <span className="addacct-ico"><Wallet size={22} strokeWidth={1.8} /></span>
                <span className="addacct-tname">Cash</span>
                <span className="addacct-tsub">A manual balance you track</span>
              </button>
              <button type="button" className="addacct-tile" onClick={() => { setErr(null); setStep("investment"); }}>
                <span className="addacct-ico"><LineChart size={22} strokeWidth={1.8} /></span>
                <span className="addacct-tname">Investment</span>
                <span className="addacct-tsub">Trading 212 · Bitget</span>
              </button>
            </div>
          </>
        )}

        {step === "cash" && (
          <form onSubmit={submitCash}>
            <h3>Add cash account</h3>
            <Field label="Name"><input value={cash.name} autoFocus placeholder="e.g. Wallet, Savings jar" onChange={(e) => setCash({ ...cash, name: e.target.value })} /></Field>
            <Field label="Current balance (£)"><input inputMode="decimal" value={cash.value} onChange={(e) => setCash({ ...cash, value: e.target.value })} /></Field>
            <Field label="Type">
              <select value={cash.type} onChange={(e) => setCash({ ...cash, type: e.target.value as "PERSONAL" | "BUSINESS" })}>
                <option value="PERSONAL">Personal</option><option value="BUSINESS">Business</option>
              </select>
            </Field>
            {err && <p className="form-error">{err}</p>}
            <div className="modal-actions">
              <button type="button" onClick={() => { setErr(null); setStep("choose"); }}>Back</button>
              <button className="btn-primary" type="submit" disabled={busy}>{busy ? "Adding…" : "Add"}</button>
            </div>
          </form>
        )}

        {step === "investment" && !provider && (
          <>
            <h3>Connect an investment</h3>
            <div className="addacct-providers">
              {INVESTMENT_PROVIDER_FORMS.map((p) => (
                <button key={p.key} type="button" className="addacct-provider" onClick={() => { setConfig({}); setErr(null); setProvider(p.key); }}>
                  <BrandLogo name={p.label} src={providerLogoCandidates(INVESTMENT_PROVIDERS[p.key].domain)} size={28} />
                  <span className="addacct-pname">{p.label}</span>
                  <span className={`addacct-pkind kind-${p.kind}`}>{p.kind === "crypto" ? "Crypto" : "Stocks"}</span>
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => { setErr(null); setStep("choose"); }}>Back</button>
            </div>
          </>
        )}

        {step === "investment" && form && (
          <form onSubmit={submitInvestment}>
            <h3>Connect {form.label}</h3>
            <p className="muted" style={{ marginTop: -4, fontSize: 12.5 }}>Use a <b>read-only</b> API key. Keys are stored on this server only.</p>
            <Field label="Account name (optional)">
              <input value={invName} placeholder={`e.g. ${form.label} ISA`} onChange={(e) => setInvName(e.target.value)} />
            </Field>
            {form.credentialFields.map((f) => (
              <Field key={f.key} label={f.optional ? `${f.label} (optional)` : f.label}>
                <input
                  type={f.secret ? "password" : "text"}
                  autoComplete="off"
                  placeholder={f.placeholder}
                  value={config[f.key] ?? ""}
                  onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
                />
              </Field>
            ))}
            {err && <p className="form-error">{err}</p>}
            <div className="modal-actions">
              <button type="button" onClick={() => { setErr(null); setProvider(null); }}>Back</button>
              <button className="btn-primary" type="submit" disabled={busy}>{busy ? "Connecting…" : "Connect"}</button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}

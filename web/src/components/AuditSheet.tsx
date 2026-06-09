import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AuditEvent } from "../../../shared/types.ts";

type Tone = "dim" | "green" | "yellow" | "red" | "cyan" | "bold";
interface Line { text: string; tone?: Tone; }

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Compact currency for the terminal (− for negatives, symbol for common currencies).
const money = (n: number, ccy = "GBP") => {
  const sym = ccy === "GBP" ? "£" : ccy === "USD" ? "$" : ccy === "EUR" ? "€" : `${ccy} `;
  return `${n < 0 ? "−" : ""}${sym}${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Turn one audit event into one or more terminal lines.
function linesFor(e: AuditEvent): Line[] {
  switch (e.kind) {
    case "scope":
      return [
        { text: "● Scope", tone: "bold" },
        { text: `  ${e.total} transactions · ${e.uncategorised} uncategorised` },
        { text: `  categories: ${e.categories.join(", ")}`, tone: "dim" },
      ];
    case "rules":
      return [
        { text: "● Rules pass (free)", tone: "bold" },
        { text: `  ${e.categorised} categorised · ${e.remaining} left for AI`, tone: e.categorised ? "green" : "dim" },
      ];
    case "batch-request":
      return [
        { text: `● AI batch #${e.batch} → Gemini (${e.items.length} txns)`, tone: "bold" },
        { text: "  ── fed to model ──", tone: "dim" },
        ...e.items.map((it): Line => ({ text: `  ${it.ref.padEnd(4)} ${trunc(it.text || "(no text)", 64)}`, tone: "dim" })),
      ];
    case "batch-raw":
      return [
        { text: "  ── raw response ──", tone: "dim" },
        { text: `  ${trunc(e.text.replace(/\s+/g, " ").trim() || "(empty)", 400)}`, tone: "dim" },
      ];
    case "batch-parsed": {
      const out: Line[] = [{
        text: `  parsed ${e.returned} picks · ${e.valid} valid${e.dropped.length ? ` · ${e.dropped.length} dropped` : ""}`,
        tone: e.dropped.length ? "red" : undefined,
      }];
      for (const d of e.dropped) out.push({ text: `    dropped ${d.id} → "${d.categoryKey}" (not a category)`, tone: "red" });
      return out;
    }
    case "batch-error":
      return [{ text: `  ✗ batch error: ${e.error}`, tone: "red" }];
    case "assign":
      return [{ text: `  ${e.via === "rule" ? "rule" : "AI  "} ${trunc(e.name, 34).padEnd(34)} → ${e.to}`, tone: e.via === "rule" ? "cyan" : "green" }];
    case "skip-uncategorised":
      return [{ text: `  AI   ${trunc(e.name, 34).padEnd(34)} → left uncategorised`, tone: "yellow" }];
    case "learn":
      return [{ text: `      ↳ learned rule "${e.matchText}" → ${e.categoryKey}`, tone: "dim" }];
    case "summary": {
      const r = e.result;
      const left = r.total - r.byRules - r.byLlm;
      const out: Line[] = [
        { text: "● Summary", tone: "bold" },
        { text: `  ${r.byRules} by rules · ${r.byLlm} by AI · ${left} still uncategorised`, tone: left ? "yellow" : "green" },
        { text: `  ${r.rulesLearned} rules learned`, tone: "dim" },
      ];
      if (r.llmSkipped) out.push({ text: "  ⚠ AI skipped — no GEMINI_API_KEY set", tone: "red" });
      return out;
    }
    case "balance-change": {
      const delta = e.after - e.before;
      if (Math.abs(delta) < 0.005) return [{ text: `  balance ${money(e.after, e.currency)} (unchanged)`, tone: "dim" }];
      const d = `${delta > 0 ? "+" : "−"}${money(Math.abs(delta), e.currency)}`;
      return [{ text: `  balance ${money(e.before, e.currency)} → ${money(e.after, e.currency)}  (${d})`, tone: delta > 0 ? "green" : "yellow" }];
    }
    case "new-txns": {
      const out: Line[] = [{ text: `  ${e.items.length} new transaction${e.items.length === 1 ? "" : "s"}`, tone: "green" }];
      for (const it of e.items.slice(0, 50)) {
        out.push({ text: `    ${(it.date ?? "").padEnd(10)}  ${trunc(it.name || "(no name)", 28).padEnd(28)} ${money(it.amount).padStart(11)}`, tone: "dim" });
      }
      if (e.items.length > 50) out.push({ text: `    …and ${e.items.length - 50} more`, tone: "dim" });
      return out;
    }
    case "log":
      return [{ text: e.text, tone: e.tone }];
    case "fatal":
      return [{ text: `✗ ${e.error}`, tone: "red" }];
  }
}

// A streaming CLI-style bottom sheet. `run` is given a per-event callback and
// streams audit events (reconcile, sync, …) until its promise resolves.
export function AuditSheet({ open, title, run, onClose, onDone }: {
  open: boolean;
  title: string;
  run: (onEvent: (e: AuditEvent) => void) => Promise<void>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [running, setRunning] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!open) { startedRef.current = false; return; }
    if (startedRef.current) return;
    startedRef.current = true;
    setLines([{ text: `$ ${title.toLowerCase()}…`, tone: "bold" }]);
    setRunning(true);
    run((e) => setLines((prev) => [...prev, ...linesFor(e)]))
      .catch((err: Error) => setLines((prev) => [...prev, { text: `✗ ${err.message}`, tone: "red" }]))
      .finally(() => { setRunning(false); onDone(); });
  }, [open, run, onDone, title]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines]);

  if (!open) return null;
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(ev) => ev.stopPropagation()}>
        <div className="sheet-head">
          <span className="sheet-title">{running ? `${title}…` : `${title} audit`}</span>
          <button className="btn-sm" onClick={onClose}>{running ? "Hide" : "Close"}</button>
        </div>
        <div className="terminal" ref={bodyRef}>
          {lines.map((l, i) => (
            <div key={i} className={`tline${l.tone ? ` t-${l.tone}` : ""}`}>{l.text || " "}</div>
          ))}
          {running && <div className="tline t-dim">▍</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

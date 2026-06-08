import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api.ts";
import type { AuditEvent } from "../../../shared/types.ts";

type Tone = "dim" | "green" | "yellow" | "red" | "cyan" | "bold";
interface Line { text: string; tone?: Tone; }

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

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
    case "fatal":
      return [{ text: `✗ ${e.error}`, tone: "red" }];
  }
}

export function ReconcileSheet({ open, accountId, onClose, onDone }: {
  open: boolean;
  accountId?: string;
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
    setLines([{ text: "$ reconcile — analysing transactions…", tone: "bold" }]);
    setRunning(true);
    api.reconcileStream((e) => setLines((prev) => [...prev, ...linesFor(e)]), accountId)
      .catch((err: Error) => setLines((prev) => [...prev, { text: `✗ ${err.message}`, tone: "red" }]))
      .finally(() => { setRunning(false); onDone(); });
  }, [open, accountId, onDone]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines]);

  if (!open) return null;
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(ev) => ev.stopPropagation()}>
        <div className="sheet-head">
          <span className="sheet-title">{running ? "Reconciling…" : "Reconcile audit"}</span>
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

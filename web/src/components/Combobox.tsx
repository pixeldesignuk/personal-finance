import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ComboOption { value: string; label: string }

// A bespoke select that reads like inline table text but, on click, opens a
// searchable autocomplete popover (portalled, so table overflow can't clip it).
export function Combobox({ value, options, onChange, placeholder = "—", allowClear, clearLabel = "— none —", muted }: {
  value: string | null;
  options: ComboOption[];
  onChange: (value: string | null) => void;
  placeholder?: string;
  allowClear?: boolean;
  clearLabel?: string;
  muted?: boolean;  // render the selected value muted (e.g. an unconfirmed suggestion)
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 });

  const selected = options.find((o) => o.value === value) ?? null;
  const filtered = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ left: r.left, top: r.bottom + 4, width: Math.max(r.width, 200) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !triggerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const choose = (v: string | null) => { onChange(v); setOpen(false); setQ(""); };

  return (
    <span className="combo">
      <button ref={triggerRef} type="button" className={`combo-trigger${selected && !muted ? "" : " muted"}`}
        onClick={() => { setOpen((o) => !o); setQ(""); setActive(0); }}>
        {selected?.label ?? placeholder}<span className="combo-caret">▾</span>
      </button>
      {open && createPortal(
        <div ref={popRef} className="combo-pop" style={{ left: pos.left, top: pos.top, minWidth: pos.width }}>
          <input className="combo-search" autoFocus placeholder="Search…" value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); const o = filtered[active]; if (o) choose(o.value); }
              else if (e.key === "Escape") setOpen(false);
            }} />
          <div className="combo-list">
            {allowClear && <div className="combo-opt" onClick={() => choose(null)}>{clearLabel}</div>}
            {filtered.map((o, i) => (
              <div key={o.value} className={`combo-opt${i === active ? " active" : ""}${o.value === value ? " selected" : ""}`}
                onMouseEnter={() => setActive(i)} onClick={() => choose(o.value)}>{o.label}</div>
            ))}
            {filtered.length === 0 && <div className="combo-empty">No matches</div>}
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}

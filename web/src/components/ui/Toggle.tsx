import type { ReactNode } from "react";

// The pill switch with an optional caption. Wraps the repeated
// `<span className="switch"><input type="checkbox" …/><span className="slider"/></span>`
// markup used across settings, dashboard and budget toolbars.
export function Toggle({ checked, onChange, label, title }: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: ReactNode;
  title?: string;
}) {
  return (
    <label className="toggle-row" title={title}>
      {label != null && <span className="toggle-label">{label}</span>}
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="slider" />
      </span>
    </label>
  );
}

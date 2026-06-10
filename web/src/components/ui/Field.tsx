import type { ReactNode } from "react";

// A labelled form field: caption above the control, optional hint below. Used
// inside modal bodies.
export function Field({ label, children, hint, inline }: {
  label?: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  inline?: boolean;  // size to content rather than filling the row
}) {
  return (
    <label className={`field${inline ? " field-inline" : ""}`}>
      {label != null && <span>{label}</span>}
      {children}
      {hint != null && <p className="field-hint muted">{hint}</p>}
    </label>
  );
}

// Lay out two or more Fields side by side (they stack on narrow screens).
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="field-row">{children}</div>;
}

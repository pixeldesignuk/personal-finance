import type { ReactNode } from "react";

export interface TabItem { key: string; label: ReactNode }

// The underline filter tabs. `value`/`onChange` are typically wired to a nuqs
// query-state so the active tab lives in the URL.
export function Tabs({ value, onChange, items, bare }: {
  value: string;
  onChange: (key: string) => void;
  items: TabItem[];
  bare?: boolean;  // drop the bottom border (e.g. when nested in a card header)
}) {
  return (
    <div className={`tabs${bare ? " tabs-bare" : ""}`}>
      {items.map((t) => (
        <button key={t.key} type="button" className={`tab${value === t.key ? " active" : ""}`} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

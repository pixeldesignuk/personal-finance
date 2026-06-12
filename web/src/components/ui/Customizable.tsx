import type { ReactNode } from "react";
import { Toggle } from "./Toggle.tsx";

// Wraps a dashboard section so it can be shown/hidden in the dashboard's
// "Customize" mode. Visibility is a boolean setting (dashboard.show.*) persisted
// via the settings store.
//   • normal mode, on  → renders the card untouched (no wrapper)
//   • normal mode, off → renders nothing
//   • edit mode        → a switch sits in the card's top-right corner; when off,
//                        the card content stays visible but disabled (dimmed).
export function Customizable({ label, editing, on, onToggle, children }: {
  label: string;
  editing: boolean;
  on: boolean;
  onToggle: (value: boolean) => void;
  children: ReactNode;
}) {
  if (!editing) return on ? <>{children}</> : null;
  return (
    <div className={`customizable${on ? "" : " is-off"}`}>
      {children}
      <span className="customize-toggle">
        <Toggle checked={on} onChange={onToggle} title={on ? `Hide ${label}` : `Show ${label}`} />
      </span>
    </div>
  );
}

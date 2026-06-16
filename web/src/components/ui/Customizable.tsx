import { useState, type ReactNode } from "react";
import { Settings2 } from "lucide-react";
import { Toggle } from "./Toggle.tsx";
import { Modal } from "./Modal.tsx";

// Wraps a dashboard section so it can be shown/hidden in the dashboard's
// "Customize" mode. Visibility is a boolean setting (dashboard.show.*) persisted
// via the settings store.
//   • normal mode, on  → renders the card untouched (no wrapper)
//   • normal mode, off → renders nothing
//   • edit mode        → a switch sits in the card's top-right corner; when off,
//                        the card content stays visible but disabled (dimmed).
// A card may also pass `settings` — card-specific options shown behind a gear
// button (next to the switch) in an in-app modal, only during Customize mode.
export function Customizable({ label, editing, on, onToggle, settings, children }: {
  label: string;
  editing: boolean;
  on: boolean;
  onToggle: (value: boolean) => void;
  settings?: ReactNode;
  children: ReactNode;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  if (!editing) return on ? <>{children}</> : null;
  return (
    <div className={`customizable${on ? "" : " is-off"}`}>
      {children}
      <span className="customize-toggle">
        {settings && (
          <button type="button" className="customize-gear" title={`${label} settings`} onClick={() => setSettingsOpen(true)}>
            <Settings2 size={15} strokeWidth={2} />
          </button>
        )}
        <Toggle checked={on} onChange={onToggle} title={on ? `Hide ${label}` : `Show ${label}`} />
      </span>
      {settings && (
        <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} size="sm">
          <div className="modal-body">
            <h3>{label}</h3>
            {settings}
          </div>
        </Modal>
      )}
    </div>
  );
}

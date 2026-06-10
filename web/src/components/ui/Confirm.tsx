import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Modal } from "./Modal.tsx";

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

// App-wide confirmation dialogs — replaces window.confirm everywhere, honouring
// the rule that we always use in-app dialogs. `const confirm = useConfirm()`
// then `if (await confirm({ title, body, danger: true })) { … }`.
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    setOpts(options);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  const settle = (value: boolean) => { resolver.current?.(value); resolver.current = null; setOpts(null); };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal open={opts != null} onClose={() => settle(false)} size="sm">
        {opts && (
          <div className="modal-body">
            <h3>{opts.title}</h3>
            {opts.body != null && (typeof opts.body === "string" ? <p className="muted">{opts.body}</p> : opts.body)}
            <div className="modal-actions">
              <button type="button" onClick={() => settle(false)}>{opts.cancelLabel ?? "Cancel"}</button>
              <button type="button" className={opts.danger ? "btn-danger" : "btn-primary"} autoFocus onClick={() => settle(true)}>
                {opts.confirmLabel ?? (opts.danger ? "Delete" : "Confirm")}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider");
  return ctx;
}

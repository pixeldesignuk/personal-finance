import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type ToastTone = "info" | "success" | "error" | "loading";

export interface ToastOptions {
  tone?: ToastTone;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

export interface ToastApi {
  notify: (message: string, opts?: ToastOptions) => number;
  update: (id: number, message: string, opts?: ToastOptions) => void;
  dismiss: (id: number) => void;
}

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  action?: { label: string; onClick: () => void };
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION = 4000;

export function ToastProvider(props: {
  children: React.ReactNode;
}): React.ReactNode {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const scheduleDismiss = useCallback(
    (id: number, tone: ToastTone, duration?: number) => {
      if (tone === "loading" || duration === 0) return;
      const ms = duration ?? DEFAULT_DURATION;
      setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  const notify = useCallback(
    (message: string, opts?: ToastOptions) => {
      const tone = opts?.tone ?? "info";
      const id = idRef.current++;
      setToasts((prev) => [
        ...prev,
        { id, message, tone, action: opts?.action },
      ]);
      scheduleDismiss(id, tone, opts?.duration);
      return id;
    },
    [scheduleDismiss],
  );

  const update = useCallback(
    (id: number, message: string, opts?: ToastOptions) => {
      const tone = opts?.tone ?? "info";
      setToasts((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, message, tone, action: opts?.action } : t,
        ),
      );
      scheduleDismiss(id, tone, opts?.duration);
    },
    [scheduleDismiss],
  );

  const api: ToastApi = { notify, update, dismiss };

  return (
    <ToastContext.Provider value={api}>
      {props.children}
      {createPortal(
        <div className="toast-stack">
          {toasts.map((t) => (
            <div key={t.id} className={"toast-item t-" + t.tone}>
              {t.tone === "loading" && <span className="toast-spinner" />}
              <span>{t.message}</span>
              {t.action && (
                <button
                  className="toast-action"
                  onClick={t.action.onClick}
                >
                  {t.action.label}
                </button>
              )}
              <button
                className="toast-x"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}

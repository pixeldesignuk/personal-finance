import { useEffect, useRef, type ReactNode } from "react";

// A controlled wrapper around the native <dialog>. Pass `open` and `onClose`;
// the component drives showModal()/close(), backdrop-click and Esc for you.
// Children are the dialog contents — usually a `<form className="modal-body">`
// or `<div className="modal-body">`. They mount only while open, so form state
// resets cleanly between openings.
export function Modal({ open, onClose, children, size }: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  size?: "sm" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  // Esc fires the dialog's `cancel` event — route it through onClose so the
  // parent's `open` state stays in sync.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCancel = (e: Event) => { e.preventDefault(); onClose(); };
    d.addEventListener("cancel", onCancel);
    return () => d.removeEventListener("cancel", onCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={`modal${size === "sm" ? " modal-sm" : size === "lg" ? " modal-lg" : ""}`}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      {open && children}
    </dialog>
  );
}

// A refund is marked with a "refund — …" note (set by Gmail order-matching, the
// review screen, and auto-detection). This is the single marker that keeps a
// refund out of every review/reconcile flow and on the budget's Refunds line.
// Kept here (no deps) so both server and web share one definition.
export const REFUND_NOTE_RE = /^refund\b/i;
export const isRefundNote = (note: string | null | undefined): boolean => REFUND_NOTE_RE.test(note ?? "");

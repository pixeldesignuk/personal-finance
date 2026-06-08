import type { AuditEvent } from "../../shared/types.ts";

// The trace event type lives in shared/types.ts so the web audit sheet can use
// it too. Re-exported here for server-side imports.
export type { AuditEvent } from "../../shared/types.ts";

export type AuditFn = (e: AuditEvent) => void;

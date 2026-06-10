import { db } from "./db.ts";
import type { AuditFn } from "../categorise/audit.ts";

// Wrap a sync so it's persisted to SyncRun: timings, outcome, summary, and the
// full audit trail (including AI inputs + raw responses). `stream` forwards each
// event live (e.g. to an NDJSON response); pass a no-op for headless runs.
export async function recordSyncRun<T extends object>(
  source: string,
  stream: AuditFn,
  run: (audit: AuditFn) => Promise<T>,
): Promise<T> {
  const lines: unknown[] = [];
  const audit: AuditFn = (e) => { lines.push(e); stream(e); };
  const rec = await db.syncRun.create({ data: { source, status: "running" } });
  try {
    const summary = await run(audit);
    await db.syncRun.update({ where: { id: rec.id }, data: { status: "ok", finishedAt: new Date(), summary: summary as object, log: lines as object } });
    return summary;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    audit({ kind: "fatal", error: msg });
    await db.syncRun.update({ where: { id: rec.id }, data: { status: "error", finishedAt: new Date(), error: msg, log: lines as object } });
    throw err;
  }
}

import { Router } from "express";
import { reconcile } from "../categorise/reconcile.ts";

export const reconcileRouter = Router();

// One-off "Reconcile" trigger: auto-categorise all uncategorised transactions
// (rules first, then Gemini Flash for the rest).
reconcileRouter.post("/reconcile", async (_req, res, next) => {
  try {
    res.json(await reconcile());
  } catch (err) {
    next(err);
  }
});

// Streaming variant: runs the same pipeline but writes each audit event as a
// line of NDJSON as it happens, so the UI can show a live CLI-style trace.
reconcileRouter.post("/reconcile/stream", async (req, res) => {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no"); // don't let proxies buffer the stream
  res.flushHeaders?.();
  const accountId = typeof req.body?.accountId === "string" ? req.body.accountId : undefined;
  try {
    await reconcile({ accountId, audit: (e) => res.write(`${JSON.stringify(e)}\n`) });
  } catch (err) {
    res.write(`${JSON.stringify({ kind: "fatal", error: err instanceof Error ? err.message : String(err) })}\n`);
  } finally {
    res.end();
  }
});

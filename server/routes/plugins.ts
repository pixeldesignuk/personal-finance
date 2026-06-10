import { Router } from "express";
import { db } from "../lib/db.ts";
import { env } from "../env.ts";
import * as gmail from "../plugins/gmail.ts";
import { syncGmail, ensureGmailWatch } from "../plugins/gmailSync.ts";
import { toEmailOrderDTO, orderMatchesQuery } from "../plugins/emailOrderDTO.ts";
import { recordSyncRun } from "../lib/syncRun.ts";
import type { AuditFn } from "../categorise/audit.ts";
import type { PluginsDTO } from "../../shared/types.ts";

export const pluginsRouter = Router();

// Coalesce bursts of Gmail push notifications into a single sync, and never run
// two at once (a queued flag re-runs once if a push lands mid-sync).
let pushSyncing = false;
let pushQueued = false;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
async function runGmailPushSync(): Promise<void> {
  if (pushSyncing) { pushQueued = true; return; }
  pushSyncing = true;
  try {
    await recordSyncRun("gmail-push", () => {}, (audit) => syncGmail(audit));
  } catch (err) {
    console.error("gmail push sync failed:", err instanceof Error ? err.message : err);
  } finally {
    pushSyncing = false;
    if (pushQueued) { pushQueued = false; void runGmailPushSync(); }
  }
}
function scheduleGmailPushSync(): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { void runGmailPushSync(); }, 4000);
}

pluginsRouter.get("/plugins", async (_req, res, next) => {
  try {
    const p = await db.plugin.findUnique({ where: { id: "gmail" } });
    const [orders, matched] = await Promise.all([
      db.emailOrder.count(),
      db.emailOrder.count({ where: { matched: true } }),
    ]);
    const dto: PluginsDTO = {
      gmail: {
        available: gmail.gmailConfigured(),
        connected: Boolean(p?.connected),
        email: p?.email ?? null,
        lastSyncAt: p?.lastSyncAt?.toISOString() ?? null,
        orders,
        matched,
        realtime: Boolean(env.GMAIL_PUBSUB_TOPIC),
        watchExpiry: p?.watchExpiry?.toISOString() ?? null,
      },
    };
    res.json(dto);
  } catch (err) { next(err); }
});

pluginsRouter.get("/plugins/gmail/connect", (_req, res) => {
  if (!gmail.gmailConfigured()) { res.status(400).send("Gmail not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."); return; }
  res.redirect(gmail.authUrl("gmail"));
});

pluginsRouter.get("/plugins/gmail/callback", async (req, res, next) => {
  try {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) { res.redirect(`${env.APP_BASE_URL}/plugins?gmail=denied`); return; }
    const tok = await gmail.exchangeCode(code);
    const profile = await gmail.getProfile(tok.access_token);
    const expiry = new Date(Date.now() + tok.expires_in * 1000);
    await db.plugin.upsert({
      where: { id: "gmail" },
      create: { id: "gmail", connected: true, email: profile.emailAddress, refreshToken: tok.refresh_token ?? null, accessToken: tok.access_token, tokenExpiry: expiry },
      update: { connected: true, email: profile.emailAddress, accessToken: tok.access_token, tokenExpiry: expiry, ...(tok.refresh_token ? { refreshToken: tok.refresh_token } : {}) },
    });
    // Arm realtime push (no-op unless GMAIL_PUBSUB_TOPIC is configured).
    try { await ensureGmailWatch(true); } catch (err) { console.error("gmail watch arm failed:", err instanceof Error ? err.message : err); }
    res.redirect(`${env.APP_BASE_URL}/plugins?gmail=connected`);
  } catch (err) { next(err); }
});

// Pub/Sub push endpoint: Gmail → Pub/Sub → here when new mail arrives. We ack
// immediately and run a debounced incremental sync (which parses + matches +
// re-matches). The shared-secret token in the URL keeps it from being triggered
// by anyone who guesses the path.
pluginsRouter.post("/plugins/gmail/push", (req, res) => {
  if (env.GMAIL_PUSH_TOKEN && String(req.query.token ?? "") !== env.GMAIL_PUSH_TOKEN) { res.sendStatus(403); return; }
  res.sendStatus(204); // ack fast so Pub/Sub doesn't retry
  scheduleGmailPushSync();
});

// Streaming sync: fetch order emails, Gemini-extract, match to transactions.
pluginsRouter.post("/plugins/gmail/sync/stream", async (_req, res) => {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  const stream: AuditFn = (e) => res.write(`${JSON.stringify(e)}\n`);
  try {
    await recordSyncRun("gmail", stream, (audit) => syncGmail(audit));
  } catch {
    // already streamed (fatal) + recorded
  } finally {
    res.end();
  }
});

// Parsed orders with optional search (?q=) and filter (all|matched|unmatched|refunds).
pluginsRouter.get("/plugins/gmail/orders", async (req, res, next) => {
  try {
    const filter = String(req.query.filter ?? "all");
    const q = String(req.query.q ?? "").trim();
    const where: Record<string, unknown> = { total: { not: null } };
    if (filter === "matched") where.matched = true;
    else if (filter === "unmatched") { where.matched = false; where.isRefund = false; }
    else if (filter === "refunds") where.isRefund = true;
    const rows = await db.emailOrder.findMany({ where, orderBy: [{ emailDate: "desc" }, { createdAt: "desc" }], take: 600 });
    let orders = rows.map(toEmailOrderDTO);
    if (q) orders = orders.filter((o) => orderMatchesQuery(o, q));
    res.json(orders.slice(0, 400));
  } catch (err) { next(err); }
});

pluginsRouter.post("/plugins/gmail/disconnect", async (_req, res, next) => {
  try {
    // Best-effort: cancel the push watch while we still have a token.
    const p = await db.plugin.findUnique({ where: { id: "gmail" } });
    if (p?.accessToken) { try { await gmail.stopWatch(p.accessToken); } catch { /* token may be stale; ignore */ } }
    await db.plugin.upsert({
      where: { id: "gmail" },
      create: { id: "gmail", connected: false },
      update: { connected: false, email: null, refreshToken: null, accessToken: null, tokenExpiry: null, watchExpiry: null },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

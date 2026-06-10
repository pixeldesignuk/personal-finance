import { Router } from "express";
import { db } from "../lib/db.ts";
import { env } from "../env.ts";
import * as gmail from "../plugins/gmail.ts";
import { syncGmail } from "../plugins/gmailSync.ts";
import { toEmailOrderDTO, orderMatchesQuery } from "../plugins/emailOrderDTO.ts";
import type { AuditFn } from "../categorise/audit.ts";
import type { PluginsDTO } from "../../shared/types.ts";

export const pluginsRouter = Router();

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
    res.redirect(`${env.APP_BASE_URL}/plugins?gmail=connected`);
  } catch (err) { next(err); }
});

// Streaming sync: fetch order emails, Gemini-extract, match to transactions.
pluginsRouter.post("/plugins/gmail/sync/stream", async (_req, res) => {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  const audit: AuditFn = (e) => res.write(`${JSON.stringify(e)}\n`);
  try {
    await syncGmail(audit);
  } catch (err) {
    audit({ kind: "fatal", error: err instanceof Error ? err.message : String(err) });
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
    await db.plugin.upsert({
      where: { id: "gmail" },
      create: { id: "gmail", connected: false },
      update: { connected: false, email: null, refreshToken: null, accessToken: null, tokenExpiry: null },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

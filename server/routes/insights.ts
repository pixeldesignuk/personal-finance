// server/routes/insights.ts
import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { runReconcile } from "../lib/insightConditions.ts";
import { renderInsight, sortInsights, type InsightKind } from "../lib/insights.ts";
import { setStringSetting } from "../lib/settings.ts";
import type { InsightDTO } from "../../shared/types.ts";

export const insightsRouter = Router();

// Reconcile against live data, then return the VISIBLE inbox (open, not snoozed).
insightsRouter.get("/insights", async (_req, res, next) => {
  try {
    const now = new Date();
    await runReconcile(now);
    const rows = await db.insight.findMany({
      where: { resolvedAt: null, dismissedAt: null, OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] },
      orderBy: { createdAt: "desc" },
    });
    const dtos: InsightDTO[] = sortInsights(rows.map((r) => {
      const kind = r.kind as InsightKind;
      const rendered = renderInsight(kind, (r.payload ?? {}) as Record<string, unknown>);
      return { id: r.id, kind, ...rendered, createdAt: r.createdAt.toISOString() };
    }));
    res.json(dtos);
  } catch (e) { next(e); }
});

const patchSchema = z.object({ action: z.enum(["dismiss", "snooze", "read"]), until: z.string().optional() });

insightsRouter.patch("/insights/:id", async (req, res, next) => {
  try {
    const { action, until } = patchSchema.parse(req.body);
    const now = new Date();
    const row = await db.insight.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: "not found" });

    if (action === "dismiss") {
      await db.insight.update({ where: { id: row.id }, data: { dismissedAt: now } });
    } else if (action === "snooze") {
      const until_ = until ? new Date(until) : null;
      if (!until_ || Number.isNaN(until_.getTime()) || until_ <= now) return res.status(400).json({ error: "invalid until" });
      await db.insight.update({ where: { id: row.id }, data: { snoozedUntil: until_ } });
    } else { // read — for the digest kind this is what resolves it
      const data: { readAt: Date; resolvedAt?: Date } = { readAt: now };
      if (row.kind === "new_transactions") {
        data.resolvedAt = now;
        await setStringSetting("insights.txnsSeenAt", now.toISOString());
      }
      await db.insight.update({ where: { id: row.id }, data });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

import { Router } from "express";
import { z } from "zod";
import { SETTING_DEFS, getSettings, setSetting, getStringSettings, setStringSetting, getDashboardOrder, setDashboardOrder } from "../lib/settings.ts";
import type { SettingsDTO } from "../../shared/types.ts";

export const settingsRouter = Router();

settingsRouter.get("/settings", async (_req, res, next) => {
  try {
    const [values, strings, order] = await Promise.all([getSettings(), getStringSettings(), getDashboardOrder()]);
    const dto: SettingsDTO = { defs: SETTING_DEFS, values, strings, order };
    res.json(dto);
  } catch (err) { next(err); }
});

// Replace the dashboard section order: { order: string[] }.
settingsRouter.put("/settings/dashboard-order", async (req, res, next) => {
  try {
    const { order } = z.object({ order: z.array(z.string()) }).parse(req.body);
    await setDashboardOrder(order);
    res.json({ order: await getDashboardOrder() });
  } catch (err) { next(err); }
});

// Partial update: { "<key>": boolean | string, ... } — only known keys accepted.
// Boolean keys route to the boolean store; string keys to the validated string store.
settingsRouter.patch("/settings", async (req, res, next) => {
  try {
    const body = z.record(z.string(), z.union([z.boolean(), z.string()])).parse(req.body);
    const known = new Set(SETTING_DEFS.map((d) => d.key));
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "boolean") { if (known.has(key)) await setSetting(key, value); }
      else await setStringSetting(key, value);
    }
    res.json({ values: await getSettings(), strings: await getStringSettings() });
  } catch (err) { next(err); }
});

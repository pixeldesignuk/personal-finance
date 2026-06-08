import { Router } from "express";
import { z } from "zod";
import { SETTING_DEFS, getSettings, setSetting } from "../lib/settings.ts";
import type { SettingsDTO } from "../../shared/types.ts";

export const settingsRouter = Router();

settingsRouter.get("/settings", async (_req, res, next) => {
  try {
    const values = await getSettings();
    const dto: SettingsDTO = { defs: SETTING_DEFS, values };
    res.json(dto);
  } catch (err) { next(err); }
});

// Partial update: { "<key>": boolean, ... } — only known keys are accepted.
settingsRouter.patch("/settings", async (req, res, next) => {
  try {
    const body = z.record(z.string(), z.boolean()).parse(req.body);
    const known = new Set(SETTING_DEFS.map((d) => d.key));
    for (const [key, value] of Object.entries(body)) {
      if (known.has(key)) await setSetting(key, value);
    }
    res.json(await getSettings());
  } catch (err) { next(err); }
});

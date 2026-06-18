// server/routes/plan.ts
import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { getStringSettings, setStringSetting } from "../lib/settings.ts";
import { buildPlanContext } from "../lib/planData.ts";
import type { PlanOverride } from "../../shared/types.ts";

export const planRouter = Router();

// Parse the plan.overrides JSON setting into a { stepKey: "handled"|"na" } map.
function parseOverrides(raw: string | undefined): Record<string, PlanOverride> {
  try {
    const o = JSON.parse(raw || "{}");
    if (!o || typeof o !== "object") return {};
    const out: Record<string, PlanOverride> = {};
    for (const [k, v] of Object.entries(o)) if (v === "handled" || v === "na") out[k] = v;
    return out;
  } catch { return {}; }
}

planRouter.get("/plan", async (_req, res, next) => {
  try {
    const { dto } = await buildPlanContext();
    res.json(dto);
  } catch (e) { next(e); }
});

// Toggle a per-step escape hatch. value null clears the override (un-marks the step).
planRouter.patch("/plan/override", async (req, res, next) => {
  try {
    const body = z.object({
      step: z.enum(["budget", "ef_small", "pension", "ef_full", "invest"]),
      value: z.enum(["handled", "na"]).nullable(),
    }).parse(req.body);
    const settings = await getStringSettings();
    const overrides = parseOverrides(settings["plan.overrides"]);
    if (body.value === null) delete overrides[body.step];
    else overrides[body.step] = body.value;
    await setStringSetting("plan.overrides", JSON.stringify(overrides));
    res.json({ overrides });
  } catch (e) { next(e); }
});

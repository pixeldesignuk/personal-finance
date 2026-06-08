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

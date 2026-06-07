import { Router } from "express";
import { GoCardlessClient } from "../gocardless/client.ts";
import type { InstitutionDTO } from "../../shared/types.ts";

export const institutionsRouter = Router();
const gc = new GoCardlessClient();

institutionsRouter.get("/institutions", async (_req, res, next) => {
  try {
    const list = await gc.getInstitutions("gb");
    const dto: InstitutionDTO[] = list.map((i) => ({ id: i.id, name: i.name, bic: i.bic }));
    res.json(dto);
  } catch (err) {
    next(err);
  }
});

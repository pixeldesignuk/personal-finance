import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { slug } from "../lib/rules.ts";
import type { PersonDTO } from "../../shared/types.ts";

export const peopleRouter = Router();

peopleRouter.get("/people", async (_req, res, next) => {
  try {
    const people = await db.person.findMany({ where: { archived: false }, orderBy: { sortOrder: "asc" } });
    const dto: PersonDTO[] = people.map((p) => ({ id: p.id, key: p.key, name: p.name, sortOrder: p.sortOrder, archived: p.archived }));
    res.json(dto);
  } catch (err) { next(err); }
});

peopleRouter.post("/people", async (req, res, next) => {
  try {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    const key = slug(name);
    if (await db.person.findFirst({ where: { key } })) {
      res.status(409).json({ error: "A person with that name already exists" });
      return;
    }
    const p = await db.person.create({ data: { name, key } });
    res.json({ id: p.id, key: p.key });
  } catch (err) { next(err); }
});

peopleRouter.patch("/people/:id", async (req, res, next) => {
  try {
    const b = z.object({ name: z.string().min(1).optional(), sortOrder: z.number().int().optional(), archived: z.boolean().optional() }).parse(req.body);
    const updated = await db.person.update({ where: { id: Number(req.params.id) }, data: b });
    res.json({ id: updated.id });
  } catch (err) { next(err); }
});

peopleRouter.delete("/people/:id", async (req, res, next) => {
  try {
    const p = await db.person.findUnique({ where: { id: Number(req.params.id) } });
    if (!p) { res.status(404).json({ error: "Person not found" }); return; }
    const used = await db.transaction.count({ where: { personKey: p.key } });
    if (used > 0) { res.status(409).json({ error: "Person has transactions — archive instead." }); return; }
    await db.person.delete({ where: { id: p.id } });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

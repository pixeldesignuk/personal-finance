import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { slug } from "../lib/rules.ts";
import type { CategoryDTO } from "../../shared/types.ts";

export const categoriesRouter = Router();

categoriesRouter.get("/categories", async (req, res, next) => {
  try {
    const all = req.query.all === "1";
    const cats = await db.category.findMany({
      where: all ? {} : { archived: false },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    const dto: CategoryDTO[] = cats.map((c) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      monthlyAmount: Number(c.monthlyAmount.toString()),
      sortOrder: c.sortOrder,
      archived: c.archived,
    }));
    res.json(dto);
  } catch (err) { next(err); }
});

// Active category names + reserved values, for pickers.
categoriesRouter.get("/category-names", async (_req, res, next) => {
  try {
    const cats = await db.category.findMany({ where: { archived: false }, orderBy: { name: "asc" } });
    res.json([...cats.map((c) => ({ key: c.key, name: c.name })), { key: "income", name: "Income" }, { key: "transfer", name: "Transfer" }]);
  } catch (err) { next(err); }
});

categoriesRouter.post("/categories", async (req, res, next) => {
  try {
    const b = z.object({
      name: z.string().min(1),
      monthlyAmount: z.number().min(0).default(0),
    }).parse(req.body);
    const key = slug(b.name);
    if (await db.category.findFirst({ where: { OR: [{ key }, { name: b.name }] } })) {
      res.status(409).json({ error: "A category with that name already exists" });
      return;
    }
    const c = await db.category.create({ data: { name: b.name, key, monthlyAmount: b.monthlyAmount } });
    res.json({ id: c.id });
  } catch (err) { next(err); }
});

categoriesRouter.patch("/categories/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const b = z.object({
      name: z.string().min(1).optional(),
      monthlyAmount: z.number().min(0).optional(),
      sortOrder: z.number().int().optional(),
      archived: z.boolean().optional(),
    }).parse(req.body);
    const existing = await db.category.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ error: "Category not found" }); return; }
    const updated = await db.category.update({ where: { id }, data: b });
    res.json({ id: updated.id });
  } catch (err) { next(err); }
});

categoriesRouter.delete("/categories/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const cat = await db.category.findUnique({ where: { id } });
    if (!cat) { res.status(404).json({ error: "Category not found" }); return; }
    const used = await db.transaction.count({ where: { OR: [{ category: cat.key }, { categoryOverride: cat.key }] } });
    if (used > 0) { res.status(409).json({ error: "Category has transactions — archive it instead." }); return; }
    await db.category.delete({ where: { id } });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

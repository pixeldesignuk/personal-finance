import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { slug } from "../lib/rules.ts";
import type { CategoryGroupDTO } from "../../shared/types.ts";

export const categoriesRouter = Router();

categoriesRouter.get("/categories", async (req, res, next) => {
  try {
    const all = req.query.all === "1";
    const groups = await db.categoryGroup.findMany({
      include: { categories: { orderBy: { sortOrder: "asc" } } },
      orderBy: { sortOrder: "asc" },
    });
    const dto: CategoryGroupDTO[] = groups.map((g) => ({
      id: g.id,
      name: g.name,
      sortOrder: g.sortOrder,
      categories: g.categories
        .filter((c) => all || !c.archived)
        .map((c) => ({
          id: c.id, key: c.key, name: c.name, groupId: c.groupId,
          monthlyAmount: Number(c.monthlyAmount.toString()),
          goal: c.goal != null ? Number(c.goal.toString()) : null,
          sortOrder: c.sortOrder, archived: c.archived,
        })),
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
      groupId: z.number().int(),
      monthlyAmount: z.number().min(0).default(0),
      goal: z.number().min(0).nullable().optional(),
    }).parse(req.body);
    const key = slug(b.name);
    const c = await db.category.create({ data: { name: b.name, key, groupId: b.groupId, monthlyAmount: b.monthlyAmount, goal: b.goal ?? null } });
    res.json({ id: c.id });
  } catch (err) { next(err); }
});

categoriesRouter.patch("/categories/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const b = z.object({
      name: z.string().min(1).optional(),
      groupId: z.number().int().optional(),
      monthlyAmount: z.number().min(0).optional(),
      goal: z.number().min(0).nullable().optional(),
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
    await db.allocation.deleteMany({ where: { categoryId: id } });
    await db.category.delete({ where: { id } });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

categoriesRouter.post("/category-groups", async (req, res, next) => {
  try {
    const b = z.object({ name: z.string().min(1), sortOrder: z.number().int().default(0) }).parse(req.body);
    const g = await db.categoryGroup.create({ data: b });
    res.json({ id: g.id });
  } catch (err) { next(err); }
});

categoriesRouter.patch("/category-groups/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const b = z.object({ name: z.string().min(1).optional(), sortOrder: z.number().int().optional() }).parse(req.body);
    await db.categoryGroup.update({ where: { id }, data: b });
    res.json({ id });
  } catch (err) { next(err); }
});

categoriesRouter.delete("/category-groups/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const count = await db.category.count({ where: { groupId: id } });
    if (count > 0) { res.status(409).json({ error: "Group is not empty" }); return; }
    await db.categoryGroup.delete({ where: { id } });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

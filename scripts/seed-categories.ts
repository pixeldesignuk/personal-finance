// Consolidate the category taxonomy into the agreed 17-category set grouped by
// Needs / Wants / Savings & Debt (50/30/20-friendly). Remaps every transaction,
// merchant rule, and merchant suggestion off the old keys, merges budgets
// (dropping 0-transaction phantom duplicates like a Rent budget alongside a real
// Mortgage), removes the personal-allowance categories, and deletes the now-empty
// old categories.
//
//   pnpm tsx scripts/seed-categories.ts            # dry run — prints the plan
//   pnpm tsx scripts/seed-categories.ts --apply    # write the changes
//
// Idempotent — safe to re-run.
import { db } from "../server/lib/db.ts";

interface Target { group: string; key: string; name: string }

const TARGET: Target[] = [
  // Needs
  { group: "Needs", key: "housing", name: "Housing" },
  { group: "Needs", key: "utilities", name: "Utilities & Bills" },
  { group: "Needs", key: "groceries", name: "Groceries" },
  { group: "Needs", key: "transport", name: "Transport" },
  { group: "Needs", key: "health-fitness", name: "Health & Fitness" },
  { group: "Needs", key: "family-care", name: "Family & Care" },
  { group: "Needs", key: "education", name: "Education" },
  // Wants
  { group: "Wants", key: "dining-out", name: "Dining Out" },
  { group: "Wants", key: "shopping", name: "Shopping" },
  { group: "Wants", key: "subscriptions", name: "Subscriptions" },
  { group: "Wants", key: "entertainment", name: "Entertainment" },
  { group: "Wants", key: "travel-holidays", name: "Travel & Holidays" },
  { group: "Wants", key: "gifts-charities", name: "Gifts & Charities" },
  { group: "Wants", key: "pets", name: "Pets" },
  // Savings & Debt (the 50/30/20 "20%")
  { group: "Savings & Debt", key: "savings-investments", name: "Savings & Investing" },
  { group: "Savings & Debt", key: "debt-payments", name: "Debt Payments" },
  { group: "Savings & Debt", key: "fees", name: "Fees" },
];

// Every old key -> its new key. Self-maps (groceries -> groceries) are listed so
// budget merging treats every category uniformly. The two personal-allowance
// categories are being removed: their (0) transactions fall back to uncategorised
// and the categories are deleted.
const MAP: Record<string, string> = {
  "mortgage-payment": "housing", rent: "housing", "council-tax": "housing", "home-maintenance": "housing",
  electricity: "utilities", gas: "utilities", water: "utilities", broadband: "utilities", mobile: "utilities",
  groceries: "groceries",
  fuel: "transport", "car-finance": "transport", "car-insurance": "transport", "car-tax": "transport", "car-maintenance": "transport", travel: "transport",
  "medical-pharmacy": "health-fitness", fitness: "health-fitness", "self-care": "health-fitness",
  "baby-toddler": "family-care", "kids-activities": "family-care",
  "islamic-education": "education",
  "eating-out": "dining-out",
  "household-shopping": "shopping", clothing: "shopping",
  subscriptions: "subscriptions", "cloud-services": "subscriptions", "amazon-prime": "subscriptions",
  entertainment: "entertainment",
  holidays: "travel-holidays",
  "charity-sadaqah": "gifts-charities", gifts: "gifts-charities",
  pets: "pets",
  "savings-investments": "savings-investments", "emergency-fund": "savings-investments",
  "credit-card-repayment": "debt-payments",
  "bank-fees": "fees", "cash-atm": "fees",
  "mansoor-personal": "uncategorised", "halima-personal": "uncategorised",
};
const REMOVED = ["mansoor-personal", "halima-personal"];
const APPLY = process.argv.includes("--apply");

async function main() {
  const cats = await db.category.findMany();
  const amount = new Map(cats.map((c) => [c.key, Number(c.monthlyAmount)] as const));
  const txnCount = new Map<string, number>();
  for (const r of await db.transaction.groupBy({ by: ["category"], _count: true })) if (r.category) txnCount.set(r.category, (txnCount.get(r.category) ?? 0) + r._count);
  for (const r of await db.transaction.groupBy({ by: ["categoryOverride"], _count: true })) if (r.categoryOverride) txnCount.set(r.categoryOverride, (txnCount.get(r.categoryOverride) ?? 0) + r._count);

  // Merge budgets: sum contributors, but drop a contributor with 0 transactions
  // when a sibling has transactions (a phantom duplicate, e.g. Rent next to a
  // real Mortgage). A lone unspent budget (e.g. Pets) is kept.
  const dropped: { key: string; amount: number; into: string }[] = [];
  const budget = new Map<string, number>();
  for (const t of TARGET) {
    const contribs = Object.entries(MAP).filter(([, nk]) => nk === t.key).map(([ok]) => ok);
    const anyTxns = contribs.some((k) => (txnCount.get(k) ?? 0) > 0);
    let sum = 0;
    for (const k of contribs) {
      const a = amount.get(k) ?? 0;
      if ((txnCount.get(k) ?? 0) > 0 || !anyTxns) sum += a;
      else if (a > 0) dropped.push({ key: k, amount: a, into: t.key });
    }
    // max(computed, existing) keeps re-runs idempotent: once applied, the old
    // contributor keys are gone so `sum` recomputes to 0 — we must not overwrite
    // the already-merged budget (or a value the user has since edited) with it.
    budget.set(t.key, Math.max(Math.round(sum * 100) / 100, amount.get(t.key) ?? 0));
  }

  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (pass --apply to write) ===\n");
  console.log("Transaction moves:");
  for (const [ok, nk] of Object.entries(MAP)) {
    if (ok === nk) continue;
    const c = txnCount.get(ok) ?? 0;
    if (c) console.log(`  ${ok.padEnd(22)} -> ${nk.padEnd(20)} ${c} txns`);
  }
  console.log("\nResulting categories + merged budgets:");
  let group = "";
  for (const t of TARGET) { if (t.group !== group) { group = t.group; console.log(`  [${group}]`); } console.log(`    ${t.name.padEnd(20)} £${budget.get(t.key)}`); }
  console.log("\nDropped budgets (re-add in the UI if you still want them):");
  for (const d of dropped) console.log(`  ${d.key.padEnd(22)} £${d.amount}  (was merging into ${d.into})`);
  for (const r of REMOVED) console.log(`  ${r.padEnd(22)} £${amount.get(r) ?? 0}  (category removed)`);

  if (!APPLY) { await db.$disconnect(); return; }

  // 1. Move transactions off old keys.
  for (const [ok, nk] of Object.entries(MAP)) {
    if (ok === nk) continue;
    await db.transaction.updateMany({ where: { category: ok }, data: { category: nk } });
    await db.transaction.updateMany({ where: { categoryOverride: ok }, data: { categoryOverride: nk } });
  }
  // 2. Remap merchant rules + merchant category suggestions.
  for (const [ok, nk] of Object.entries(MAP)) {
    if (ok === nk) continue;
    await db.rule.updateMany({ where: { categoryKey: ok }, data: { categoryKey: nk } });
    await db.merchant.updateMany({ where: { categoryKey: ok }, data: { categoryKey: nk } });
  }
  // 3. Upsert the target set (name/group/order + merged budget; unarchive).
  for (let i = 0; i < TARGET.length; i++) {
    const t = TARGET[i];
    await db.category.upsert({
      where: { key: t.key },
      create: { key: t.key, name: t.name, group: t.group, monthlyAmount: budget.get(t.key) ?? 0, sortOrder: i, archived: false },
      update: { name: t.name, group: t.group, monthlyAmount: budget.get(t.key) ?? 0, sortOrder: i, archived: false },
    });
  }
  // 4. Keep the uncategorised sentinel.
  await db.category.upsert({ where: { key: "uncategorised" }, create: { key: "uncategorised", name: "Uncategorised", group: null, monthlyAmount: 0, sortOrder: 999 }, update: {} });
  // 5. Delete the now-empty old categories (merged-away + removed only).
  const targetKeys = new Set(TARGET.map((t) => t.key));
  const toDelete = new Set<string>(REMOVED);
  for (const ok of Object.keys(MAP)) if (!targetKeys.has(ok) && ok !== "uncategorised") toDelete.add(ok);
  for (const k of toDelete) {
    const ex = await db.category.findFirst({ where: { key: k } });
    if (ex) await db.category.delete({ where: { id: ex.id } });
  }
  const total = await db.category.count({ where: { key: { not: "uncategorised" } } });
  console.log(`\nApplied. ${total} categories across 3 groups.`);
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

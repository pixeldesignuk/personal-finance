// Reshape categories into the agreed grouped taxonomy, preserving budget
// amounts, remapping existing transactions off merged/renamed keys, hiding the
// "uncategorised" sentinel, and seeding transfer-detection for card payments.
//
//   pnpm tsx scripts/seed-categories.ts
//
// Idempotent — safe to re-run.
import { db } from "../server/lib/db.ts";

interface Target { group: string; key: string; name: string; amount: number; }

const TARGET: Target[] = [
  // Monthly Bills
  { group: "Monthly Bills", key: "rent", name: "Rent", amount: 500 },
  { group: "Monthly Bills", key: "council-tax", name: "Council Tax", amount: 135 },
  { group: "Monthly Bills", key: "electricity", name: "Electricity", amount: 70 },
  { group: "Monthly Bills", key: "gas", name: "Gas", amount: 51.7 },
  { group: "Monthly Bills", key: "water", name: "Water", amount: 25.14 },
  { group: "Monthly Bills", key: "broadband", name: "Broadband", amount: 23.99 },
  { group: "Monthly Bills", key: "mobile", name: "Mobile", amount: 45 },
  // Frequent
  { group: "Frequent", key: "groceries", name: "Groceries", amount: 250 },
  { group: "Frequent", key: "eating-out", name: "Eating Out", amount: 0 },
  { group: "Frequent", key: "fuel", name: "Fuel", amount: 50 },
  { group: "Frequent", key: "mansoor-personal", name: "Mansoor Personal", amount: 50 },
  { group: "Frequent", key: "halima-personal", name: "Halima Personal", amount: 200 },
  { group: "Frequent", key: "entertainment", name: "Entertainment", amount: 0 },
  // Non-Monthly Expenses
  { group: "Non-Monthly Expenses", key: "car-finance", name: "Car Finance", amount: 116.63 },
  { group: "Non-Monthly Expenses", key: "car-insurance", name: "Car Insurance", amount: 70.56 },
  { group: "Non-Monthly Expenses", key: "car-tax", name: "Car Tax", amount: 0 },
  { group: "Non-Monthly Expenses", key: "car-maintenance", name: "Car Maintenance & Parts", amount: 40 },
  { group: "Non-Monthly Expenses", key: "home-maintenance", name: "Home Maintenance", amount: 0 },
  { group: "Non-Monthly Expenses", key: "household-shopping", name: "Household & Shopping", amount: 0 },
  { group: "Non-Monthly Expenses", key: "medical-pharmacy", name: "Medical & Pharmacy", amount: 0 },
  { group: "Non-Monthly Expenses", key: "baby-toddler", name: "Baby & Toddler", amount: 22 },
  { group: "Non-Monthly Expenses", key: "kids-activities", name: "Kids Activities", amount: 22 },
  { group: "Non-Monthly Expenses", key: "islamic-education", name: "Islamic Education", amount: 60 },
  { group: "Non-Monthly Expenses", key: "gifts", name: "Gifts", amount: 0 },
  { group: "Non-Monthly Expenses", key: "pets", name: "Pets", amount: 50 },
  { group: "Non-Monthly Expenses", key: "holidays", name: "Holidays", amount: 0 },
  // Subscriptions
  { group: "Subscriptions", key: "cloud-services", name: "Cloud Services", amount: 11 },
  { group: "Subscriptions", key: "amazon-prime", name: "Amazon Prime", amount: 10 },
  { group: "Subscriptions", key: "subscriptions", name: "Other Subscriptions", amount: 0 },
  // Quality of Life
  { group: "Quality of Life", key: "clothing", name: "Clothing", amount: 0 },
  { group: "Quality of Life", key: "fitness", name: "Fitness", amount: 0 },
  { group: "Quality of Life", key: "self-care", name: "Self Care", amount: 0 },
  { group: "Quality of Life", key: "charity-sadaqah", name: "Charity / Sadaqah", amount: 0 },
  // Savings
  { group: "Savings", key: "savings-investments", name: "Savings & Investments", amount: 0 },
  { group: "Savings", key: "emergency-fund", name: "Emergency Fund", amount: 0 },
  // Money
  { group: "Money", key: "bank-fees", name: "Bank Fees & Interest", amount: 0 },
  { group: "Money", key: "cash-atm", name: "Cash / ATM", amount: 0 },
];

// Specific recurring patterns that the merchant-name learner can't catch
// (they live in the remittance text, so no clean merchant token) -> seed a rule.
const RULE_SEEDS: { matchText: string; categoryKey: string }[] = [
  { matchText: "interest - see summary", categoryKey: "bank-fees" },
  { matchText: "interest see summary", categoryKey: "bank-fees" },
];

// old key -> new key (transactions are moved off the old key before it's deleted)
const REMAP: Record<string, string> = {
  "electric-gas": "electricity",
  "mobile-phone": "mobile",
  "mobile-phone-contract": "mobile",
  "car-maintenance-fund": "car-maintenance",
  "meow-meow": "pets",
  "kendamil": "baby-toddler",
  "maryam-football": "kids-activities",
  "arabic-intensive-fees": "islamic-education",
  "mansoor-expenses": "mansoor-personal",
  "halima-expenses": "halima-personal",
};

// Counterparties that mean "moving money between your own accounts" (paying a
// credit card) — these are transfers, not spending, or you'd double-count.
const TRANSFER_PATTERNS = ["american express", "amex", "capital one", "payment received"];

async function main() {
  // 1. Move transactions off merged/renamed keys.
  for (const [oldK, newK] of Object.entries(REMAP)) {
    const a = await db.transaction.updateMany({ where: { category: oldK }, data: { category: newK } });
    const b = await db.transaction.updateMany({ where: { categoryOverride: oldK }, data: { categoryOverride: newK } });
    if (a.count || b.count) console.log(`remap ${oldK} -> ${newK}: ${a.count} category, ${b.count} override`);
  }

  // 2. Upsert the target set (name/group/amount/order; unarchive).
  for (let i = 0; i < TARGET.length; i++) {
    const t = TARGET[i];
    await db.category.upsert({
      where: { key: t.key },
      create: { key: t.key, name: t.name, group: t.group, monthlyAmount: t.amount, sortOrder: i, archived: false },
      update: { name: t.name, group: t.group, monthlyAmount: t.amount, sortOrder: i, archived: false },
    });
  }

  // 3. Ensure the uncategorised sentinel exists (hidden from manager/budgets).
  await db.category.upsert({
    where: { key: "uncategorised" },
    create: { key: "uncategorised", name: "Uncategorised", group: null, monthlyAmount: 0, sortOrder: 999 },
    update: {},
  });

  // 4. Delete only the known merged-away keys (now empty after the remap).
  //    Deliberately NOT "everything not in TARGET" — that would nuke any
  //    categories added by hand in the UI later.
  for (const oldK of Object.keys(REMAP)) {
    const ex = await db.category.findFirst({ where: { key: oldK } });
    if (ex) { await db.category.delete({ where: { id: ex.id } }); console.log(`deleted merged category ${oldK}`); }
  }

  // 5. Seed transfer-detection rules and apply to existing transactions.
  for (const p of TRANSFER_PATTERNS) {
    if (!(await db.rule.findFirst({ where: { matchText: p } }))) {
      await db.rule.create({ data: { matchText: p, categoryKey: "transfer", priority: 100 } });
    }
    const r = await db.transaction.updateMany({
      where: {
        category: { not: "transfer" },
        OR: [
          { merchantName: { contains: p, mode: "insensitive" } },
          { creditorName: { contains: p, mode: "insensitive" } },
          { debtorName: { contains: p, mode: "insensitive" } },
          { remittanceInfo: { contains: p, mode: "insensitive" } },
        ],
      },
      data: { category: "transfer" },
    });
    if (r.count) console.log(`transfer "${p}": ${r.count} transactions`);
  }

  // 6. Seed specific fee/interest rules and apply to existing uncategorised rows.
  for (const s of RULE_SEEDS) {
    if (!(await db.rule.findFirst({ where: { matchText: s.matchText } }))) {
      await db.rule.create({ data: { matchText: s.matchText, categoryKey: s.categoryKey, priority: 90 } });
    }
    const r = await db.transaction.updateMany({
      where: {
        category: "uncategorised", categoryOverride: null,
        OR: [
          { merchantName: { contains: s.matchText, mode: "insensitive" } },
          { remittanceInfo: { contains: s.matchText, mode: "insensitive" } },
        ],
      },
      data: { category: s.categoryKey },
    });
    if (r.count) console.log(`rule "${s.matchText}" -> ${s.categoryKey}: ${r.count} transactions`);
  }

  const cats = await db.category.count({ where: { key: { not: "uncategorised" } } });
  console.log(`Done. ${cats} categories across ${new Set(TARGET.map((t) => t.group)).size} groups.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

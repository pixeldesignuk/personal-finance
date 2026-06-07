export type Category =
  | "income"
  | "groceries"
  | "eating-out"
  | "transport"
  | "bills"
  | "shopping"
  | "other";

export interface CategorizeInput {
  amount: number;
  text: string; // merchant/creditor/remittance combined
}

const RULES: { category: Category; keywords: string[] }[] = [
  { category: "groceries", keywords: ["tesco", "sainsbury", "asda", "aldi", "lidl", "morrison", "waitrose", "co-op", "iceland"] },
  { category: "eating-out", keywords: ["pret", "greggs", "mcdonald", "kfc", "nando", "costa", "starbucks", "deliveroo", "uber eats", "just eat", "restaurant", "cafe"] },
  { category: "transport", keywords: ["tfl", "uber", "trainline", "national rail", "bp ", "shell", "esso", "petrol", "parking"] },
  { category: "bills", keywords: ["british gas", "edf", "octopus energy", "thames water", "council tax", "vodafone", "ee ", "o2", "three", "sky", "virgin media", "netflix", "spotify", "insurance"] },
  { category: "shopping", keywords: ["amazon", "argos", "ikea", "asos", "ebay", "currys", "john lewis", "next ", "primark"] },
];

const INCOME_TERMS = ["salary", "payroll", "wages", "hmrc", "refund"];

export function categorize(tx: CategorizeInput): Category {
  const text = tx.text.toLowerCase();
  if (tx.amount > 0) {
    if (INCOME_TERMS.some((t) => text.includes(t))) return "income";
    return "income"; // any credit treated as income in v1
  }
  for (const rule of RULES) {
    if (rule.keywords.some((k) => text.includes(k))) return rule.category;
  }
  return "other";
}

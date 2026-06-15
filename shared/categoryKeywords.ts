// High-precision keyword → category lexicon. Suggests a category from the words
// ON a transaction (merchant name, note / receipt summary, line items) when there
// is no learned rule to lean on. Deliberately conservative: only unambiguous
// tokens, so a hit is a real signal — never a wild guess like filing a milkshake
// under "education". Matched on a leading word boundary against lowercased text,
// so "shake" hits "freak shake" and "creamery" hits "Rassams Creamery".
const KEYWORDS: Record<string, string[]> = {
  "dining-out": [
    "cafe", "café", "coffee", "costa", "starbucks", "nero", "restaurant", "grill", "kitchen",
    "pizza", "pizzeria", "burger", "kebab", "milkshake", "shake", "dessert", "creamery", "gelato",
    "ice cream", "bakery", "patisserie", "diner", "bistro", "brasserie", "takeaway", "eatery",
    "nando", "mcdonald", "kfc", "subway", "greggs", "domino", "sushi", "ramen", "noodle", "wok",
    "curry", "tikka", "biryani", "tapas", "chai", "deli", "chippy", "rocher", "waffle", "crepe",
    "donut", "doughnut", "chocolate", "shawarma", "peri", "buffet", "lounge",
  ],
  groceries: [
    "supermarket", "grocer", "grocery", "tesco", "sainsbury", "asda", "aldi", "lidl", "morrison",
    "waitrose", "iceland", "spar", "costco", "butcher", "greengrocer", "fishmonger",
  ],
  transport: [
    "uber", "bolt", "taxi", "petrol", "fuel", "shell", "esso", "texaco", "parking", "train",
    "rail", "trainline", "oyster", "tram", "toll", "tyre", "garage", "evri",
  ],
  "health-fitness": [
    "pharmacy", "chemist", "boots", "superdrug", "fitness", "dental", "dentist", "clinic",
    "optician", "physio", "wellness",
  ],
  entertainment: [
    "cinema", "odeon", "cineworld", "theatre", "concert", "steam", "playstation", "xbox",
    "nintendo", "arcade", "bowling",
  ],
  subscriptions: [
    "netflix", "spotify", "disney", "icloud", "patreon", "subscription", "membership",
  ],
  shopping: [
    "amazon", "ebay", "argos", "ikea", "zara", "primark", "asos", "currys", "clothing",
    "footwear", "decathlon",
  ],
  pets: ["petsmart", "veterinary", "petshop"],
  "travel-holidays": [
    "hotel", "airbnb", "ryanair", "easyjet", "airline", "flight", "expedia", "hostel", "resort",
  ],
  "gifts-charities": [
    "charity", "donation", "mosque", "masjid", "justgiving", "gofundme", "florist",
  ],
  utilities: [
    "broadband", "vodafone", "giffgaff", "octopus energy", "british gas", "virgin media",
  ],
  housing: ["mortgage", "council tax"],
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Category keys whose keywords appear in `text`, ranked by number of distinct
// keyword hits (most relevant first).
export function keywordCategories(text: string | null | undefined): string[] {
  if (!text) return [];
  const hay = text.toLowerCase();
  const scored: { key: string; hits: number }[] = [];
  for (const [key, words] of Object.entries(KEYWORDS)) {
    let hits = 0;
    for (const w of words) if (new RegExp(`\\b${escape(w.toLowerCase())}`).test(hay)) hits++;
    if (hits) scored.push({ key, hits });
  }
  return scored.sort((a, b) => b.hits - a.hits).map((s) => s.key);
}

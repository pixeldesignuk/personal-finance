-- Curated, region-tenanted merchant directory (seeded from the Name Suggestion
-- Index + Wikidata). A known brand → its domain, brand colour, and the bucket key
-- of its stored logo, so a matched merchant carries a logo URL directly without a
-- per-render provider call. `slug`/`aliases` are normalised match keys.
CREATE TABLE IF NOT EXISTS "MerchantDirectory" (
  "id"        TEXT PRIMARY KEY,
  "region"    TEXT NOT NULL DEFAULT 'UK',
  "name"      TEXT NOT NULL,
  "slug"      TEXT NOT NULL,
  "aliases"   TEXT[] NOT NULL DEFAULT '{}',
  "domain"    TEXT,
  "logoKey"   TEXT,
  "color"     TEXT,
  "wikidata"  TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "MerchantDirectory_region_slug_key" ON "MerchantDirectory" ("region", "slug");
CREATE INDEX IF NOT EXISTS "MerchantDirectory_region_idx" ON "MerchantDirectory" ("region");

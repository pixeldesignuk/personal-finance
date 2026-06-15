-- Server-side merchant-logo repository: a per-domain cache of logos resolved from
-- providers (Brandfetch / logo.dev / DuckDuckGo) and stored in the object bucket.
-- `key` is the bucket object key (NULL = resolved but no logo found — a negative
-- cache, re-checked once stale). `color` holds a brand colour hex when a provider
-- supplies one (for a future avatar tint).
CREATE TABLE IF NOT EXISTS "LogoCache" (
  "domain"    TEXT PRIMARY KEY,
  "key"       TEXT,
  "source"    TEXT,
  "color"     TEXT,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

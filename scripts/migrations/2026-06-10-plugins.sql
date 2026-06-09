-- Gmail (and future) integration: connection tokens + parsed email orders.
CREATE TABLE IF NOT EXISTS "Plugin" (
  "id"           TEXT PRIMARY KEY,
  "connected"    BOOLEAN NOT NULL DEFAULT false,
  "email"        TEXT,
  "refreshToken" TEXT,
  "accessToken"  TEXT,
  "tokenExpiry"  TIMESTAMP(3),
  "lastSyncAt"   TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "EmailOrder" (
  "id"            TEXT PRIMARY KEY,
  "source"        TEXT NOT NULL DEFAULT 'gmail',
  "messageId"     TEXT NOT NULL UNIQUE,
  "emailDate"     TIMESTAMP(3),
  "merchantName"  TEXT,
  "merchantToken" TEXT,
  "total"         DECIMAL,
  "currency"      TEXT,
  "orderNumber"   TEXT,
  "items"         JSONB,
  "subject"       TEXT,
  "transactionId" TEXT,
  "matched"       BOOLEAN NOT NULL DEFAULT false,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

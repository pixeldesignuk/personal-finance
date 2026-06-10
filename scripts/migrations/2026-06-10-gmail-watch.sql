-- Gmail realtime: track when the current users.watch registration expires so a
-- renewal job can re-arm it before Google drops it (~7-day max lifetime).
ALTER TABLE "Plugin" ADD COLUMN IF NOT EXISTS "watchExpiry" TIMESTAMP(3);

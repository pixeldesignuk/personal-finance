import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  GOCARDLESS_SECRET_ID: z.string().min(1),
  GOCARDLESS_SECRET_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  APP_BASE_URL: z.string().url(),
  PORT: z.string().default("3000"),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_ALLOWED_CHAT_ID: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-flash-latest"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Gmail realtime (Pub/Sub push). Topic is the full resource name
  // (projects/<id>/topics/<name>); the token is a shared secret in the push URL.
  GMAIL_PUBSUB_TOPIC: z.string().optional(),
  GMAIL_PUSH_TOKEN: z.string().optional(),
  // Background full-sync cadence (minutes). 0 disables the in-process scheduler.
  // Also what keeps the Gmail push watch renewed (it lapses after ~7 days).
  SYNC_INTERVAL_MINUTES: z.string().default("60"),
  TRADING_212_KEY_ID: z.string().optional(),
  TRADING_212_SECRET: z.string().optional(),
  TRADING212_BASE_URL: z.string().optional(),
  BITGET_API_KEY: z.string().optional(),
  BITGET_API_SECRET: z.string().optional(),
  BITGET_PASSPHRASE: z.string().optional(),
  BITGET_USD_GBP: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
  throw new Error(
    `Invalid/missing environment variables: ${missing}. ` +
      `Copy .env.example to .env and fill them in.`,
  );
}

export const env = {
  ...parsed.data,
  // Accept TELEGRAM_BOT_KEY as an alias for TELEGRAM_BOT_TOKEN (env naming drift).
  TELEGRAM_BOT_TOKEN: parsed.data.TELEGRAM_BOT_TOKEN ?? process.env.TELEGRAM_BOT_KEY,
};

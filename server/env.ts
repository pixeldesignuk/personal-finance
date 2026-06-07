import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  GOCARDLESS_SECRET_ID: z.string().min(1),
  GOCARDLESS_SECRET_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  APP_BASE_URL: z.string().url(),
  PORT: z.string().default("3000"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
  throw new Error(
    `Invalid/missing environment variables: ${missing}. ` +
      `Copy .env.example to .env and fill them in.`,
  );
}

export const env = parsed.data;

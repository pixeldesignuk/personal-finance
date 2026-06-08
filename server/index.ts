import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { env } from "./env.ts";
import { institutionsRouter } from "./routes/institutions.ts";
import { connectRouter } from "./routes/connect.ts";
import { syncRouter } from "./routes/sync.ts";
import { dashboardRouter } from "./routes/dashboard.ts";
import { accountsRouter } from "./routes/accounts.ts";
import { transactionsRouter } from "./routes/transactions.ts";
import { summaryRouter } from "./routes/summary.ts";
import { telegramRouter } from "./routes/telegram.ts";
import { categoriesRouter } from "./routes/categories.ts";
import { envelopesRouter } from "./routes/envelopes.ts";

const app = express();
app.use(express.json());

app.use("/api", institutionsRouter);
app.use("/api", connectRouter);
app.use("/api", syncRouter);
app.use("/api", dashboardRouter);
app.use("/api", accountsRouter);
app.use("/api", transactionsRouter);
app.use("/api", summaryRouter);
app.use("/api", telegramRouter);
app.use("/api", categoriesRouter);
app.use("/api", envelopesRouter);

// Serve built frontend in production.
const __dirname = dirname(fileURLToPath(import.meta.url));
const webDist = join(__dirname, "..", "web", "dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.use((_req, res) => res.sendFile(join(webDist, "index.html")));
}

// Error handler.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : "Internal error";
  console.error(err);
  res.status(500).json({ error: message });
});

app.listen(Number(env.PORT), () => {
  console.log(`Finance app listening on :${env.PORT}`);
});

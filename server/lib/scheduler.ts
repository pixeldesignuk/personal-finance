import { env } from "../env.ts";
import { runFullSync } from "../routes/sync.ts";
import { isWithinActiveHours, SYNC_TIMEZONE } from "./activeHours.ts";

// In-process background sync. The app is a single always-on service, so a timer
// here is simpler than an external cron and keeps everything (DB, env, Gmail
// watch renewal) in one place. Each tick runs the same work as POST /sync/all,
// tagged "cron" in the sync log. Runs never overlap; nothing fires on boot
// (avoids a sync storm on every redeploy/restart).
let running = false;

export function startSyncScheduler(): void {
  const minutes = Number(env.SYNC_INTERVAL_MINUTES);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    console.log("[scheduler] disabled (SYNC_INTERVAL_MINUTES=0)");
    return;
  }
  // Daytime-only window (Europe/London) so we don't sync overnight — eases
  // GoCardless rate limits and avoids needless 3am churn. Defaults 7am–11pm.
  const startHour = Number(env.SYNC_ACTIVE_START_HOUR);
  const endHour = Number(env.SYNC_ACTIVE_END_HOUR);
  const gated = Number.isFinite(startHour) && Number.isFinite(endHour) && !(startHour === 0 && endHour === 24);
  console.log(
    `[scheduler] background full sync every ${minutes} min` +
      (gated ? `, active ${startHour}:00–${endHour}:00 ${SYNC_TIMEZONE}` : ", 24h"),
  );
  const tick = async () => {
    if (gated && !isWithinActiveHours(new Date(), startHour, endHour)) {
      console.log(`[scheduler] outside active hours (${startHour}:00–${endHour}:00 ${SYNC_TIMEZONE}) — skipping tick`);
      return;
    }
    if (running) { console.log("[scheduler] previous run still in progress — skipping tick"); return; }
    running = true;
    const t0 = Date.now();
    try {
      const r = await runFullSync(() => {}, "cron");
      console.log(`[scheduler] sync ok in ${Math.round((Date.now() - t0) / 1000)}s — ${JSON.stringify(r)}`);
    } catch (err) {
      console.error("[scheduler] sync failed:", err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, minutes * 60_000);
  timer.unref?.(); // don't keep the process alive solely for the timer
}

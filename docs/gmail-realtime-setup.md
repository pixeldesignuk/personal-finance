# Gmail realtime (Pub/Sub push) — setup

Realtime order capture: Gmail publishes a notification to a Google Cloud Pub/Sub
topic the moment new mail arrives → Pub/Sub POSTs our webhook → the app runs an
incremental Gmail sync (parse new orders, match to transactions, re-match open
orders). Without this, the app still stays fresh via the scheduled `/api/sync/all`
cron — this just makes it near-instant.

**The matching itself is bidirectional and already works without any of this:** an
order parsed before its bank transaction posts stays `unmatched` and is linked
automatically on the next bank sync (`rematchOpenOrders` runs after every sync).
Realtime only changes *how fast* new emails get parsed.

## One-time Google Cloud setup (~10 min)

Use the same Google Cloud project as your `GOOGLE_CLIENT_ID`.

1. **Enable the Pub/Sub API** — Cloud Console → APIs & Services → enable "Cloud Pub/Sub API".
2. **Create a topic** — Pub/Sub → Topics → Create topic, e.g. `gmail-orders`.
   Its full name is `projects/<PROJECT_ID>/topics/gmail-orders`.
3. **Let Gmail publish to it** — on the topic → Permissions → Add principal:
   - Principal: `gmail-api-push@system.gserviceaccount.com`
   - Role: `Pub/Sub Publisher`
4. **Create a push subscription** — on the topic → Create subscription:
   - Delivery type: **Push**
   - Endpoint URL: `https://<your-railway-domain>/api/plugins/gmail/push?token=<GMAIL_PUSH_TOKEN>`
     (pick any long random string for `<GMAIL_PUSH_TOKEN>` — it guards the endpoint)
   - Leave "Enable authentication" off (the `?token=` shared secret is the guard).
   - Ack deadline 10s is fine; the endpoint acks immediately.

## App configuration

Set these env vars (Railway → Variables, and locally in `.env`):

```
GMAIL_PUBSUB_TOPIC=projects/<PROJECT_ID>/topics/gmail-orders
GMAIL_PUSH_TOKEN=<the same long random string used in the subscription URL>
```

Then **reconnect Gmail** (Plugins → Disconnect → Connect) so the app registers the
`users.watch`. The Plugins page "Realtime" row should show `On · renews <date>`.

## How it stays alive

- A Gmail watch lapses after ~7 days. The app re-arms it automatically inside
  `/api/sync/all` (`ensureGmailWatch`), so as long as the daily/periodic sync cron
  runs (see the "Wire scheduled syncs" backlog item), the watch never expires.
- Push notifications are debounced (4s) and never overlap; a burst of emails
  triggers a single sync, recorded as a `gmail-push` run in the sync log.

## Verifying

- Plugins page → Gmail card → "Realtime: On · renews <date>".
- Send/receive an order email → within a few seconds a `gmail-push` entry appears
  under "Recent syncs", and the order shows on the Orders page.
- If nothing happens: check the Pub/Sub subscription's delivery metrics for 4xx/5xx,
  confirm the endpoint URL token matches `GMAIL_PUSH_TOKEN`, and confirm the topic
  grants Publisher to `gmail-api-push@system.gserviceaccount.com`.

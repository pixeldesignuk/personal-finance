#!/usr/bin/env bash
# Register the Telegram webhook to point at the deployed app.
# Requires TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, APP_BASE_URL in the env.
set -euo pipefail
: "${TELEGRAM_BOT_TOKEN:?}"; : "${TELEGRAM_WEBHOOK_SECRET:?}"; : "${APP_BASE_URL:?}"
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=${APP_BASE_URL}/api/telegram/webhook" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  -d "allowed_updates=[\"message\",\"callback_query\"]"
echo

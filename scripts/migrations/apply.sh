#!/usr/bin/env bash
# Apply a standalone .sql migration to a Postgres database via psql.
#
# Usage:
#   DATABASE_URL=postgres://... ./scripts/migrations/apply.sh scripts/migrations/2026-06-08-add-account-nickname.sql
#
# For Railway, grab the PUBLIC connection string from:
#   Railway → your Postgres service → Connect → Postgres Connection URL
# and export it as DATABASE_URL before running.
#
# Requires the `psql` client (brew install libpq, or postgresql).
set -euo pipefail

SQL_FILE="${1:?Usage: apply.sh <path-to.sql>}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set. Export your Railway Postgres URL first." >&2
  exit 1
fi

if [[ ! -f "$SQL_FILE" ]]; then
  echo "SQL file not found: $SQL_FILE" >&2
  exit 1
fi

echo "Applying $SQL_FILE ..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SQL_FILE"
echo "Done."

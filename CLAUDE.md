# Ledger — working notes for AI sessions

Single-user personal-finance web app. **No auth.** Express 5 + TypeScript API and a
Vite 8 / React 19 SPA in one repo, Prisma v6 / Postgres on Railway, GoCardless
(open banking), Gemini (AI), Telegram bot. North-star: a budgeting app to **save
money, clear debts, and reassure you're not overspending** (see `TODO.md`).

Read **`docs/ARCHITECTURE.md`** for the full design, data model, subsystems, and
the reasoning behind the gotchas below. Read it before changing money math,
merchant naming, income/recurring detection, or bank sync.

## Standing constraints (do not violate)

- **Commit directly to `main`.** No feature branches. Commit/push only when asked.
- **Push over SSH port 443** (22 is blocked):
  `git push ssh://git@ssh.github.com:443/pixeldesignuk/personal-finance.git main`
- **Schema changes are hand-applied SQL, NOT `prisma migrate`.** Write an
  idempotent file in `scripts/migrations/YYYY-MM-DD-name.sql` (`ADD COLUMN IF NOT
  EXISTS …`), apply it with `DATABASE_URL=… bash scripts/migrations/apply.sh <file>`,
  edit `prisma/schema.prisma` to match, then `pnpm prisma generate`. There is no
  `prisma/migrations/` dir.
- **Node env:** `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"`,
  then **`pnpm`** (never npm). Load DB scripts with `export $(grep -E '^DATABASE_URL=' .env | xargs)` then `pnpm tsx <script>`.
- **Filters & tabs are URL state** via `nuqs` (`useQueryState`), never local `useState`.
- **Dialogs are always in-app** (Modal / Confirm / drawers). Never
  `window.prompt/confirm/alert`.
- **Transaction `note` is plain text — never emojis.**
- **Gemini free tier is ~20 requests/day, shared across all AI features** — the
  systemic bottleneck. AI features are idempotent and resume over days. Don't add
  AI calls that aren't strictly needed; degrade gracefully when the key is missing.
- **`tsconfig` has `noUnusedLocals`** — remove unused imports/vars or tsc fails.
- After any change: `pnpm tsc --noEmit -p tsconfig.json` and `pnpm exec vite build`
  (web is built by root vite; `web/` has no own tsconfig — root `tsconfig.json`
  `include`s `web/src`, `shared`, `server`). Run server tests with
  `node --test --import tsx server/lib/*.test.ts server/categorise/*.test.ts`.

## Gotchas that have caused real bugs (don't repeat)

- **`a ?? b` does NOT skip empty strings.** Bank feeds leave `merchantName=""`
  with the real name in `remittanceInfo`. Use `rawMerchantName(t)` /
  `firstNonEmpty(...)` from `shared/merchantName.ts` for every name-field
  coalescing — never `merchantName ?? creditorName ?? …`.
- **`merchantToken` drops tokens <2 chars** — needed so short brands (O2, EE, BP)
  survive. Don't raise it back to 3.
- **Never `display:flex` on a `<td>`.** Every `td` has a `border-bottom`; a flex
  td draws its border at the bottom of its content, which floats mid-row when a
  cell is taller (e.g. a note line). Put the flex on an inner wrapper.
- **Full-page overlays (drawers/sheets) must be portalled to `document.body`**
  (`createPortal`). A transformed ancestor traps `position:fixed`, confining the
  overlay to the page content below the header. See `TxnDrawer`, `Combobox`.
- **`Date.now()` / `new Date()` / `Math.random()` are unavailable inside Workflow
  scripts.** In normal server code they're fine. For date→ISO, format from LOCAL
  components (`getFullYear`/`getMonth`/`getDate`), not `toISOString().slice(0,10)`,
  which shifts a day under BST. Prod runs UTC so this only bites locally — but fix
  it anyway (see `billTarget`).
- **Manual/cash account balance = `manualBalance` (baseline) + sum(transactions)**,
  computed via `manualTxnSums()`. Don't treat `manualBalance` as the live balance.
- **Income projection ignores outliers.** A one-off credit (someone paying you
  back) must NOT reduce projected income. `/upcoming` treats a stream's payment as
  "arrived" only if a credit ≥60% of the typical landed (or the month's income
  already covers it).
- **Net worth vs spendable are different totals.** `summary.liquid` = net-worth
  cash (includes "not budgeted" / informational accounts, minus funds-not-yours);
  `summary.available` = spendable (excludes informational). Don't conflate.

## Known issues / backlog
- Some merchant rows have malformed tokens containing `" | "` (e.g. `shah m | SHAH M`)
  from an earlier creation path — pre-existing, not yet cleaned up.
- Budgets aren't month-versioned (single `Category.monthlyAmount`) — the headline
  gap for real envelope/rollover budgeting. See `docs/budget-app-research.md`.

# Modular dashboard cards — design

Let the user enable/disable individual dashboard cards via an on-dashboard
"Customize" mode, persisted through the existing settings/config system.

## Goal & constraints

- Each major dashboard card is independently show/hide-able.
- Visibility persists per the existing `Setting` key-value store and
  `PATCH /api/settings` — no new endpoint, no new table.
- Controls live **on the dashboard** (a "Customize" edit mode), **not** in the
  generic ⚙ `SettingsDrawer`.
- A card shows only when **its toggle is on AND its existing data condition
  holds**. Toggles never force-show a card that has no data.
- Gating is **client-side only**; `server/routes/summary.ts` is untouched.

## The toggleable cards (12)

All default `true`. Keys live under the `"Dashboard"` group, `hidden: true`.

| Setting key | Card (in `Dashboard.tsx`) |
|---|---|
| `dashboard.show.hero` | Net worth + budget hero |
| `dashboard.show.statIncome` | Income stat |
| `dashboard.show.statSpent` | Spent stat |
| `dashboard.show.statUpcoming` | Upcoming stat |
| `dashboard.show.statNet` | Net-this-month stat |
| `dashboard.show.goalDebt` | Debt goal card |
| `dashboard.show.goalSavings` | Savings goal card |
| `dashboard.show.upcoming` | Upcoming bills & income (`<Upcoming>`) |
| `dashboard.show.spendingCategories` | "Where it went" BarList |
| `dashboard.show.budgetGroups` | "Budget by group" |
| `dashboard.show.cashflow` | Cash flow chart |
| `dashboard.show.balances` | Balances by account |

Existing data conditions are preserved and AND-ed with the toggle, e.g. the debt
card still requires `debts.totalOwed > 0`, cash flow still requires
`monthly.length > 1`.

## Config-system integration

`SettingDef` gains an optional `hidden?: boolean` (in both
`shared/types.ts` and `server/lib/settings.ts`). The 12 dashboard defs are
appended to `SETTING_DEFS` with `group: "Dashboard"`, `hidden: true`,
`default: true`.

- `getSettings()` / `setSetting()` / `PATCH /api/settings` already handle any key
  in `SETTING_DEFS` — the dashboard keys persist with zero server changes beyond
  the def list. The PATCH allowlist (`known`) includes hidden defs.
- `SettingsDrawer` filters `defs` to `!d.hidden`, so the dashboard toggles do not
  appear there.

## Interaction (direct manipulation on the cards)

- A **"Customize"** button joins `PageHeader` actions (next to *Sync now*).
  Click → dashboard enters edit mode (local `useState`, transient — not URL
  state); the button label becomes **"Done"**.
- In edit mode each customizable card shows a **switch in its corner** plus a
  subtle outline. Toggling saves immediately via an optimistic
  `patchSettings({ [key]: value })` mutation (same shape as `SettingsDrawer`'s).
- A card that is **off**:
  - **edit mode:** renders as a compact **dashed ghost placeholder** showing the
    card's name + its switch, so it can be turned back on.
  - **normal mode:** renders nothing.
- Implemented via a small reusable `<Customizable settingKey label editing on
  onToggle>` wrapper around each section. The wrapper becomes the grid cell (the
  card fills it), so `.grid` layout is unchanged. Switch is absolutely positioned
  in the corner.

## Data flow in `Dashboard.tsx`

- Add `const { data: settings } = useQuery({ queryKey: ["settings"], queryFn:
  () => api.settings() })`. (Same cache key the drawer uses; here it's always
  enabled.)
- Helper `show(key)` returns `settings?.values[key] ?? true` — defaults to ON
  while loading so nothing flashes hidden.
- `editing` is local `useState(false)`.
- A `patch` mutation (optimistic update of the `["settings"]` cache, invalidate
  on settle) mirrors `SettingsDrawer`.

## Files touched

1. `shared/types.ts` — add `hidden?: boolean` to `SettingDef`.
2. `server/lib/settings.ts` — add `hidden?` to interface; append 12 dashboard
   defs.
3. `web/src/components/SettingsDrawer.tsx` — filter out `hidden` defs.
4. `web/src/components/ui/Customizable.tsx` (new) — wrapper + corner switch +
   ghost placeholder. Export from `web/src/components/ui` if that barrel exists.
5. `web/src/pages/Dashboard.tsx` — settings query, `editing` state, `patch`
   mutation, "Customize/Done" header button, wrap each of the 12 sections.
6. `web/src/styles.css` — `.customizable`, edit-mode outline, corner switch,
   `.card-ghost` dashed placeholder styles.

## Section reordering (Option A — added)

Drag-to-reorder at the **section** level (7 blocks: `hero`, `stats`, `goals`,
`upcoming`, `spending`, `cashflow`, `balances`), preserving the existing grid
groupings as atomic blocks. Per-card toggles remain within their block.

- **Persistence:** one `Setting` row `dashboard.order` = JSON array of block keys.
  `getDashboardOrder()` always returns every known key (stored order first,
  missing appended, unknown dropped) so a stale order can't hide a block.
  `setDashboardOrder()` validates against the known set. `SettingsDTO` gains
  `order: string[]`; new route `PUT /api/settings/dashboard-order`.
- **Interaction:** `@dnd-kit/core` + `@dnd-kit/sortable`. Drag is active only in
  Customize mode (`DndContext`/`SortableContext` rendered only when editing).
  Each block gets a grip handle (top-left corner, mirroring the per-card switch);
  drag starts only from the grip so toggles/links stay clickable. Reorder
  `arrayMove`s the full `order` array and persists optimistically.
- **Rendering:** `Dashboard.tsx` builds a `blocks` map (section key → node, falsy
  when gated out by data) and renders `order.filter(k => blocks[k])` — plainly
  when not editing, wrapped in `<SortableBlock>` when editing.
- New component `web/src/components/ui/SortableBlock.tsx`.

## Out of scope (YAGNI)

- Full per-card reorder (would need a unified mixed-width grid — Option B).
- Per-account or per-month card config.
- Keyboard drag sensor.

## Verification

- `pnpm tsc --noEmit -p tsconfig.json` and `pnpm exec vite build` clean.
- Manual: toggle each card off in Customize mode → it disappears on Done and
  survives a reload (persisted). Re-enable from the ghost placeholder.
- Confirm the dashboard toggles do **not** appear in the ⚙ settings drawer.

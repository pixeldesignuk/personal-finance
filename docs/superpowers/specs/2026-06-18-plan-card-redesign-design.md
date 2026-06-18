# Plan card redesign — "Your plan" command-center card

**Date:** 2026-06-18
**Component:** `web/src/components/PlanProgressCard.tsx` (full rewrite) + `.planprog-*` CSS block in `web/src/styles.css`
**Scope:** Dashboard card only. The `/savings` `PlanFlowchart` is untouched.

## Problem

The current `PlanProgressCard` is a horizontal 5-label stepper with a thin progress
bar underneath. It has been churned ~10 times (numbered → labeled → width caps →
bar tweaks) and still reads poorly:

- **Wrong hierarchy.** The cramped 5-label stepper (11px labels) is the most
  prominent element; the money — the thing that actually matters — is a thin,
  secondary afterthought.
- **Wastes the width.** The card is full-width (stacked in `dash-home`, container
  has no max-width), but the stepper is capped at 520px and floats in a wide,
  empty card.
- **No next action.** The whole card just links to `/savings`; there's no explicit
  "do this next."

## Goal

A calm, two-column card that does **both action and momentum** with a clear
hierarchy (so it still respects one-focal-element-per-card):

- **Left column = the focal action.** The current step is the hero: big amount,
  thick progress bar, "to go", and a contextual next-step button.
- **Right column = quiet momentum.** A vertical journey rail showing all 5 steps
  with a you-are-here marker — demoted context, not the focal point.

Grounded in Mobbin: Alan "You are at level 2" (vertical node path + CTA), Acorns
milestone list (vertical step states), Quicken "House" goal (calm amount + bar).

## Data (unchanged)

Uses the existing `PlanDTO` from `api.plan()` (`shared/types.ts`):

- `current: PlanStepKey | null` — active step key
- `steps: PlanStepDTO[]` — 5 ordered steps, each `{ key, state, title, detail,
  progress: { have, target, pct } | null, toGo, actionHint, overridden }`
- `surplus: number`, `efAccount`

No server/DTO changes. `SHORT_LABEL` map (budget/ef_small/pension/ef_full/invest)
is retained for the rail.

## Layout

Full-width card, two columns via CSS grid (`grid-template-columns: 1fr auto` or
`minmax`), divider between them.

### Left column — focal action

For the **current step**:

1. **Eyebrow:** the step's full title, uppercase, small, muted (e.g. "FULL
   EMERGENCY FUND").
2. **Hero amount** (only when `progress != null`): big bold `have` (e.g. `£3,200`)
   with `of £9,600 · £6,400 to go` in a lighter weight beside/below it.
3. **Progress bar** (only when `progress != null`): thick jade bar, `pct`% label.
   Width clamped `min(100, max(3, pct))`.
4. **When `progress == null`** (e.g. the budget step, or a teaser step that is
   current): skip amount + bar; show the step `detail` as a one-line descriptor
   instead.
5. **Contextual nav button** (always, for current step) — see "Primary action".

### Right column — journey rail

Vertical list of all 5 steps (Acorns/Alan style):

- Node glyph per state: `done` → jade filled circle with check; `current` → jade
  ring with dot; `upcoming`/`coming`/`locked` → hollow grey circle.
- Label = `SHORT_LABEL[key] ?? title`.
- Current row: jade, bold, with a subtle "← you" / you-are-here affordance.
- Connector line between nodes (jade up to and including done; grey after).
- Header: "Your plan".

State derivation matches today: `current` key → `current`; else `state === "done"`
→ `done`; else `upcoming`.

## Primary action (contextual nav button)

A real button in the left column whose label + destination depend on the current
step.

| Current step       | Button label        | Destination |
|--------------------|---------------------|-------------|
| `budget`           | Set up budgets      | `/budgets`  |
| `ef_small`/`ef_full` | Open savings      | `/savings`  |
| `pension`/`invest` | See plan            | `/savings`  |

Implemented as a small map keyed by `PlanStepKey` (label + `to`).

**Navigation semantics.** The outer card is a plain `div` (not a `Link`) to avoid
invalid nested anchors. There are two explicit links: the contextual button
(primary next action, per the table) and the rail header "Your plan" (`Link` to
`/savings` for the full plan). This keeps anchor semantics valid and still gives a
clear path to the full roadmap.

## Momentum / nudge line (low-noise)

- Show `£{toGo} to go` as part of the amount line (already covered above).
- When `surplus > 0` and the current step has an `actionHint`, show the
  `actionHint` as a subtle one-line nudge under the bar (muted, jade accent). No
  separate "on track" chip — keep it calm.

## States

- **No plan** (`current == null`): keep the existing empty state — a compact card
  "Set up your plan" with a "Start →" affordance linking to `/savings`.
- **Current step with progress** (`ef_*`): full hero (amount + bar) + button + rail.
- **Current step without progress** (`budget`, or teaser current): eyebrow +
  detail line + button + rail (no amount/bar).
- **Loading** (`!data`): return `null` (as today).

## Responsive

- Desktop / wide: two columns side by side, divider between.
- `≤640px`: columns stack vertically — focal action block on top, then the rail
  below it (the rail stays vertical; it's only 5 short rows). Divider becomes a
  horizontal rule. Hero amount scales down slightly.

## Visual language

Reuse existing tokens: `--jade` (done/current/bars/accents), `--ink`/`--ink-2`/
`--ink-3` (text hierarchy), `--line-strong` (tracks/connectors/divider),
`--surface`/`--bg`. Card uses the standard `.card` chrome. Progress bar mirrors
existing `.planprog-bar` styling (8px, rounded, jade fill).

## CSS

Replace the entire `.planprog-*` block in `web/src/styles.css` with the new
two-column rules. Keep the `.planprog-` namespace (CLAUDE.md gotcha: must stay
namespaced to avoid colliding with `PlanFlowchart`'s `.plan-*`). New classes
(indicative): `.planprog-card`, `.planprog-main`, `.planprog-rail`,
`.planprog-eyebrow`, `.planprog-amount`, `.planprog-sub`, `.planprog-bar`,
`.planprog-nudge`, `.planprog-cta`, `.planprog-rstep`/`-rnode`/`-rlabel`,
`.planprog-empty`.

## Out of scope

- No changes to `PlanFlowchart.tsx` (`/savings`) or any server/DTO code.
- No new plan steps, no real money-transfer actions, no "on track" computation.
- No animation beyond the existing bar width transition.

## Verification

- `pnpm tsc --noEmit -p tsconfig.json` and `pnpm exec vite build` pass.
- Manual: load the dashboard, screenshot the card via Playwright in a few states
  (current = ef step with progress; current = budget step without progress; empty
  / no plan), confirm hierarchy reads as "money first, journey as quiet context"
  and that the layout uses the full width and collapses cleanly on narrow widths.

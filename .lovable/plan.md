## Goal

When the user taps **Move to {day}** in the chatbot, detect whether the cascade would push any session on or after the plan's `race_date`. If so, block the silent move and offer three explicit choices in chat — with a recommended option based on time to race.

## Where changes happen

- `src/lib/plan-day-actions.ts` — new pure helpers for cascade simulation, race-date conflict detection, and the three resolution strategies.
- `src/components/AIChatbot.tsx` — fetch `race_date` with the active plan, run the conflict check before applying a move, and render a 3-option choice block when a conflict exists.

No backend / schema changes — `training_plans.race_date` already exists (nullable ISO date).

## Behaviour

### Conflict detection (runs before any write)

1. Compute the cascade exactly like the existing `applyMoveSession` does: target date = next existing workout after the source date; if that target has a workout, walk its consecutive chain forward by one day.
2. If `race_date` is null → no conflict, proceed as today (no behaviour change).
3. Otherwise, compute the new date of every shifted session. A conflict exists if **any** shifted session would land on or after `race_date`.

### Chat message when a conflict is found

The coach reply replaces the normal success toast with a message in the chat:

> Moving this session to **Wednesday 20 May** would push **2 later sessions past your race date of Friday 3 July**. Here are your options:

Followed by three buttons (vertical stack, matching the existing day-action button style). The recommended option is marked with a subtle "Recommended" chip on the right.

### The three options

**Option 1 — Stick to race date** (compress)
- Move the session to the computed target date.
- Then compress the tail: the sessions that would otherwise overflow are redistributed into the remaining days before `race_date`, packed back-to-back where needed (no inserted rest days).
- Implementation: walk the shifted chain; for any session whose new date ≥ race_date, pull it backward day-by-day until it sits strictly before race_date and doesn't collide with a *non-shifted* later session. If two sessions end up on the same day after compression, merge by keeping the later (race-specific) one and demoting the earlier to a "compressed" easy session — simplest acceptable behaviour: just stack them on consecutive days starting from `race_date - N`. Confirmation summary: *"Session moved to Wed 20/05. 2 later sessions compressed to fit before race day."*

**Option 2 — Move race date** (shift)
- Compute `new_race_date = race_date + cascadeDays` (cascadeDays = 1 in the current single-day-shift model; future-proofed as `max(new_date - old_date)` across the chain).
- Show the new race date inline on the button label: *"Move race date to Friday 10 July"*.
- On tap: apply the normal cascade move AND update `training_plans.race_date` in the same write.
- Confirmation summary: *"Session moved. Race date shifted from Fri 03/07 to Fri 10/07."*

**Option 3 — Skip the missed session** (recommended near race)
- Run `applySkipSession` on the source date instead of moving.
- Plan tail and race date are untouched.
- Confirmation summary: *"Session on 18/05 skipped — plan and race date unchanged."*

### Recommendation logic

- `daysToRace = race_date - today` (calendar days).
- If `daysToRace > 28` → recommend **Option 1** (compress).
- If `daysToRace ≤ 28` → recommend **Option 3** (skip).
- The "Recommended" chip is rendered next to the chosen option; the other two remain selectable. Never auto-apply.

### No-conflict path

If `race_date` is null, or no shifted session crosses it, behaviour is unchanged — single tap on **Move to {day}** applies the cascade immediately, as today.

## Technical details

### New helpers in `plan-day-actions.ts`

```ts
export interface CascadePreview {
  targetDate: Date;
  shifted: Array<{ originalDate: Date; newDate: Date; rawText: string }>;
}

export function previewMoveCascade(
  planContent: string,
  dateUk: string,
): CascadePreview | null;

export function detectRaceDateConflict(
  preview: CascadePreview,
  raceDateIso: string | null,
): { hasConflict: boolean; overflowCount: number; cascadeDays: number };

export function applyMoveCompressed(
  planContent: string,
  dateUk: string,
  raceDateIso: string,
): DayActionResult | null;

export function applyMoveAndShiftRace(
  planContent: string,
  dateUk: string,
  raceDateIso: string,
): { result: DayActionResult; newRaceDateIso: string } | null;
```

`applyMoveSession` is refactored to internally use `previewMoveCascade` so the preview and the actual edit can never diverge.

### Chatbot changes

- The existing `useEffect` that caches `activePlanContent` also caches `activePlanRaceDate` (read `race_date` in the same select).
- `applyDayAction(dateUk, "move")` becomes:
  1. Build preview.
  2. If `detectRaceDateConflict` returns `hasConflict: false` → run the existing move path.
  3. Otherwise, push an assistant message with the explanation text + a new `[[ACTION:race-conflict:DD/MM/YYYY]]` marker, and render three buttons that call new handlers: `applyMoveCompressedAction`, `applyMoveAndShiftRaceAction`, `applySkipFromConflictAction`.
- Race-date persistence (Option 2) updates `training_plans` in a single `update({ content, race_date })` call alongside the markdown change, then writes an undo entry that captures both the previous content and previous race date so the existing **Undo** button restores both.

### Undo

`pushUndoEntry` currently snapshots plan content only. For Option 2, extend the chat-side undo state (`lastUndo`) to also carry the previous `race_date`, and on Undo restore both fields. (Plan-level undo history already supports arbitrary snapshots, so no schema change.)

### Edge cases

- **Race date in the past** — treat as null (no conflict check).
- **Source session is already on/after race date** — fall back to existing behaviour (no special handling needed; the user's plan is already past race day).
- **Compression with no room** (e.g. cascade overflows by more days than gap to race) — Option 1 stacks remaining sessions on the last available day before race day; surface this in the confirmation summary: *"Some sessions stacked on the final taper day — review your plan."*
- **No active plan / no race date** — current behaviour, no conflict check.

## Out of scope

- Changing how `applyMoveSession`'s chain detection works (still "consecutive scheduled workouts").
- Adding a separate confirm dialog. The three buttons in chat *are* the confirmation step.
- Touching Intervals.icu sync — that already re-reads plan content on next sync.

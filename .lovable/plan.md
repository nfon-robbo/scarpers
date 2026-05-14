# Analytics Page Plan (`/analytics`)

A new comprehensive training-plan analytics dashboard, dark-themed, mobile responsive, using existing chart primitives (`recharts` via `@/components/ui/chart`) and tokens.

## Route & Shell
- Add `/analytics` route in `src/App.tsx` inside the protected `AppLayout` group.
- Add nav entry alongside Insights / Training Plan.
- New page `src/pages/Analytics.tsx`, composed of section components in `src/components/analytics/`.
- Top bar: date range selector (Full plan / Last 4 weeks / Last week / custom) + Refresh AI summary button.
- Use existing `Card`, `Tabs`, `ChartContainer`, `ChartTooltipContent` for consistent styling.

## Data Loading
Single `useAnalyticsData(planId, range)` hook that fetches in parallel:
- Active `training_plans` row (content markdown + start_date + race_date + race_distance + goal_time).
- `activities` linked to plan (`training_plan_id = plan.id`) within range.
- `workout_reviews` for those activities (status, coach_recommendation, pace).
- `readiness_snapshots` (kind = 'eod' or 'morning') across plan period.
- `running_iq_snapshots` across plan period.
- `daily_metrics` (sleep_score, deep/rem/light, hrv, rhr) across plan period.
- `sleep_stages` for body-battery proxy.
Parse plan markdown via existing helpers (`plan-step-expand.ts`, plan calendar logic) to derive scheduled sessions per date with target pace / HR zone / type.

## Section Components

1. **PlanProgressOverview** — horizontal week-by-week timeline grid, each day a coloured pill (green=completed, blue=upcoming, red=skipped, grey=rest). Stats: % complete, X/Y sessions, weeks remaining, race-day countdown.
2. **PerformanceTrends** — `LineChart` with three series (actual pace, target pace, est race finish). Cadence as second chart below or toggle.
3. **HRAnalysis** — stacked `BarChart` per week: time in Z1–Z5 (computed from activity `raw_data` HR series, or fallback from `avg_heart_rate` and HR max from profile). Add line overlay: avg HR at easy-pace bucket per week.
4. **ReadinessVsPerformance** — `ScatterChart` x=readiness score (day of session), y=pace delta (% vs target). Colour by session type.
5. **CompletionStats** — 4 stat tiles: completion %, current streak, longest streak, adapted-vs-original count.
6. **LoadAndRecovery** — `ComposedChart`: bars = weekly intensity-weighted minutes (duration × intensity factor by type), line = 7-day rolling readiness, highlight weeks where load↑ and readiness↓ via reference area.
7. **BodyBatteryAndSleep** — dual-axis `LineChart`: body battery (proxy from sleep + HRV trend) + sleep score, both 7-day rolling.
8. **RunningIQTrend** — `LineChart` of `running_iq_snapshots.adjusted_score`. Milestone markers (`ReferenceDot`) for first continuous run, first 5K, first race-pace session, derived from activity history.
9. **RaceTimeGaugeHistory** — line of weekly best race-time estimate trending toward `goal_time`. Mini latest-vs-goal gauge.
10. **AICoachingSummary** — top-of-page card. New edge function `analytics-summary` calling Lovable AI Gateway (`google/gemini-3-flash-preview`, Claire Rayners persona) with payload: recent activities, readiness trend, pace trend, cadence trend, IQ trend. Caches in new table `analytics_summaries` (one row per user, regenerates weekly or on manual refresh).

## Backend Changes
- New table `analytics_summaries` (user_id, summary, generated_at, plan_id) with RLS (user owns own rows).
- New edge function `supabase/functions/analytics-summary/index.ts` — input: planId; output: summary text. Uses Lovable AI Gateway, validates JWT, writes cached row.

## Helpers (`src/lib/analytics/`)
- `plan-progress.ts` — derive scheduled vs completed sessions from plan markdown + activities.
- `hr-zones.ts` — compute zone time from activity HR samples or estimate from avg HR + max HR.
- `weekly-load.ts` — intensity-weighted minutes per ISO week.
- `streaks.ts` — current/longest streak.
- `rolling.ts` — 7-day rolling average util.

## Styling / UX
- All colours via design tokens (`hsl(var(--primary))`, `--accent`, `--destructive`, `--muted`).
- Use `Bebas Neue` for section headings, `Inter` body — already global.
- Each chart wrapped in `Card` + `CardHeader` + `CardContent`; charts use `ChartContainer` so tooltip styling is consistent and themed.
- Mobile: single column stack, charts at `aspect-video`, horizontal scroll for the plan timeline.
- Date range selector controls all sections via context provider.

## Out of Scope
- Editing the plan from this page.
- Exporting analytics (can be a follow-up).

Once approved I'll implement DB migration first, then edge function, then helpers, then page + sections, then wire the route and nav.

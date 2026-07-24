## Goal

Plan generation must survive: navigating away, refreshing the page, and closing the browser. When the user returns, the in-progress plan continues streaming into the UI (or is already finished and ready to apply). No re-generation, no wasted tokens.

## Approach

Move the streaming source of truth from the browser to the database. The edge function keeps generating even if the client disconnects, and writes progress to a new `plan_generation_jobs` table. The client subscribes to that row.

### 1. Database

New table `plan_generation_jobs`:

- `id` uuid PK
- `user_id` uuid (RLS: owner-only)
- `type` text (training-plan, plan-adjust, etc.)
- `status` text: `running` | `done` | `error` | `cancelled`
- `request` jsonb — the full body sent to `ai-coach`, so a resume/retry has everything
- `content` text — accumulated markdown as it streams
- `error` text, `created_at`, `updated_at`, `finished_at`
- Unique partial index: only one `running` job per (user_id, type) at a time
- GRANTs + RLS policies (SELECT/INSERT/UPDATE own rows; service_role full)
- Realtime enabled on the table

### 2. Edge function (`ai-coach`)

Add a job-backed mode for plan-type requests:

- Client POSTs with `job_mode: true` and gets back `{ job_id }` immediately (fire-and-forget), OR keeps the existing SSE for non-plan calls.
- Inside the function, wrap the existing model loop with `EdgeRuntime.waitUntil(...)` so the work continues after the HTTP response closes.
- On every delta: append to `plan_generation_jobs.content` (batched every ~500ms to avoid write storms).
- On finish: set `status=done`, `finished_at=now()`.
- On model error: set `status=error`, `error=<message>`.
- Heartbeat `updated_at` every 20s so we can detect dead jobs.

### 3. Client (`src/lib/ai-stream.ts` + `TrainingPlan.tsx`)

- Replace the SSE consumer for plan calls with a job-based flow:
  1. Insert/POST to create the job, receive `job_id`, store `job_id` in `localStorage` keyed by user.
  2. Subscribe via Supabase Realtime to `plan_generation_jobs` for that id.
  3. On each row update, diff `content` vs last seen and call `onDelta` with the new suffix — the existing progress UI keeps working.
  4. On `status=done` → `onDone`. On `status=error` → `onError`.
- On `TrainingPlan.tsx` mount: check for a `running` job for this user; if present, resume subscription and show the `PlanBuildProgress` UI with accumulated content. No new model call.
- Cancel button explicitly sets `status=cancelled` (server checks flag between chunks and stops early).

### 4. UX

- Small banner on any page: "Plan still generating…" with a link back to `/training-plan`, driven by the running job.
- When user reopens the app and a job is `done` but not yet applied, show "Your plan is ready — review".

## Technical details

- Non-plan streaming (chat, day-adjust, workout-review) keeps the current SSE path — those are short and re-runnable, and moving them adds latency.
- `EdgeRuntime.waitUntil` is the Supabase-supported way to keep work alive after the response is returned; combined with DB persistence we get true background execution.
- Realtime channel: `postgres_changes` filtered by `id=eq.<job_id>`.
- Race-safety: unique partial index on `(user_id, type) WHERE status='running'` prevents duplicate concurrent runs even across tabs.
- Continuation passes (plan continuation) run inside the same job — no client involvement.
- Old client timeout logic (`IDLE_TIMEOUT_MS_PLAN`, hard cap) is removed for plan calls; instead we consider a job dead if `updated_at` hasn't moved in 3 minutes and surface a retry button.

## Files touched

- New: `supabase/migrations/<ts>_plan_generation_jobs.sql`
- Edit: `supabase/functions/ai-coach/index.ts` (job mode + waitUntil + DB writes)
- Edit: `src/lib/ai-stream.ts` (add `streamAICoachViaJob`)
- Edit: `src/pages/TrainingPlan.tsx` (resume-on-mount, use job flow for plan types)
- New: `src/hooks/usePlanGenerationJob.ts` (subscribe + resume helper)
- New: `src/components/PlanGeneratingBanner.tsx` (global banner in `AppLayout`)
- Edit: `src/components/AppLayout.tsx` (mount banner)

## Out of scope

- Migrating chat / day-adjust / workout-review off SSE.
- Retrying failed jobs automatically (manual retry only, to avoid burning tokens on a real error).

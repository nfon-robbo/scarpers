**Onboarding Overhaul — Implementation Plan**

**1. DB migration (additive, nullable)**

Add to profiles:

- race_date DATE NULL
- race_distance TEXT NULL (values: 5k, 10k, half, marathon, other)
- race_goal_time_seconds INTEGER NULL

No backfill, no constraint changes. Existing users unaffected.

**2. src/pages/Onboarding.tsx**

State additions: hasRace: 'yes'|'no'|'', raceDate, raceDistance, goalTimeMm, goalTimeSs. Default experienceLevel to "" (was "intermediate"). Add unitSystem: 'metric'|'imperial'|'custom'|'' to OnboardingState localStorage.

Step 0 (Welcome): Under DOB add muted helper text: "We use this to set your heart-rate zones." Already required (name).

Step 1 (Units) — rewrite:

- Two large toggle cards: Metric / Imperial.
- Selecting Metric calls setUnit for all six → km, min/km, m, C, kg, cm.
- Selecting Imperial → mi, min/mi, ft, F, lbs, ft.
- Below: a collapsible "Customise units" (shadcn Collapsible) revealing the existing six selects unchanged. Opening it sets unitSystem='custom'.
- Important: opening the Customise expander must pre-populate all six selects with sensible defaults (not blank) before the user touches them. A user who goes straight to custom without first tapping Metric or Imperial must not be left with empty selects that block canNext(). If no prior unitSystem is set, pre-populate with Metric defaults when the expander opens.
- Persist selection to localStorage; no DB schema change needed (units already on profile via useUnits).

Step 2 (About You / biometrics): Add header line above fields: "These power your race predictions and recovery scores."

Step 3 (Experience & Goals) — restructured:

- Experience level — replace Select with 4 large tap-target buttons (Beginner / Intermediate / Advanced / Elite) in a 2×2 grid. None preselected. canNext() for step 3 requires a choice.
- Race block (new, above goals): "Do you have a race coming up?" Yes / Not yet toggle. If Yes: required Date input (HTML date), required Select distance (5K/10K/Half/Marathon/Other), optional goal time (two number inputs mm and ss, placeholder adjusted by distance e.g. 45:00 for 10K). canNext(): if hasRace==='yes', require raceDate + raceDistance. Goal time optional.
- Existing free-text "Training goals", "Injuries", "Anything else" remain below unchanged.

canNext() matrix:

- step 0: name required
- step 1: a unit system chosen (metric/imperial/custom) — see Customise expander note above
- step 2: no gate (current behaviour)
- step 3: experienceLevel chosen AND race fields satisfied
- step 4: no gate

handleComplete: persist new columns:

race_date: hasRace==='yes' ? raceDate : null, race_distance: hasRace==='yes' ? raceDistance : null, race_goal_time_seconds: hasRace==='yes' && goalTimeMm ? (Number(goalTimeMm)*60 + Number(goalTimeSs||0)) : null,

Add a code comment near DOB handling: verify the actual max-HR fallback value and file location during implementation before writing this comment. Do not assume 190 bpm — check src/lib/readiness.ts (or wherever max HR is calculated) and reference the real constant and file accurately. A wrong comment here is worse than no comment.

**3. /reset-password page (new src/pages/ResetPassword.tsx)**

Single component, public route, two modes:

- Request mode (default): email input → supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/reset-password' }). Success toast.
- Update mode: detect when window.location.hash contains type=recovery OR a PASSWORD_RECOVERY event fires on onAuthStateChange. Show new password + confirm fields → supabase.auth.updateUser({ password }) → toast → navigate('/dashboard').

Register in src/App.tsx as a public route /reset-password.

**4. src/pages/Auth.tsx**

- Add "Forgot password?" link (small, under password input or next to Sign-in button) → routes to /reset-password. Only show on the Sign-in tab.
- Add "Continue with Google" button (above the email field, with an "or" divider) using lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + '/dashboard' }) per Lovable Cloud guidance (managed Google OAuth). Handle result.error with toast; result.redirected returns silently.
- Replace the "Check your email" toast on signup with: toast({ title: "Account created", description: "Welcome — let's set up your profile." }). Supabase redirects via session listener to /dashboard → ProtectedRoute → /onboarding.

**5. Auth config**

- Call configure_auth with auto_confirm_email: true (keep other flags as-is). New email signups land directly in onboarding.
- Call configure_social_auth with providers: ["google"] so the Google button works immediately.

**6. Email-verification reminder banner (lightweight)**

In src/components/AppLayout.tsx (or a new EmailVerifyBanner component rendered inside it), check [user.email](http://user.email)_confirmed_at. If null, render a dismissible banner above page content: "Verify your email to secure your account. [Resend]". Resend calls supabase.auth.resend({ type: 'signup', email: [user.email](http://user.email) }). Dismissal stored in sessionStorage (per-session only, so it reappears next visit until verified).

**Files touched**

- migration (new): adds 3 columns to profiles
- src/pages/Onboarding.tsx (edit)
- src/pages/Auth.tsx (edit)
- src/pages/ResetPassword.tsx (new)
- src/App.tsx (add route)
- src/components/AppLayout.tsx + new EmailVerifyBanner.tsx
- auth config (tool calls, no file)

**Out of scope (confirmed)**

Intervals/Garmin in onboarding, post-entry profile flow, walk/run filtering, phone sign-in.

Confirm and I'll start with the migration, then code changes in one pass.
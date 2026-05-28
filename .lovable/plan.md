There are two real bugs behind what you're seeing:

**Bug 1 — Popup shows raw HTML markup**
`google-fit-callback` returns `<html>…</html>` but the browser is rendering it as plain text. That happens when the `Content-Type` header doesn't carry an explicit `text/html; charset=utf-8` (some proxies / Deno paths fall through to `text/plain`). Strava's callback has the same issue.

**Bug 2 — Onboarding still says "Connect Google Fit" after closing the popup**
`GoogleFitConnect` only listens for `postMessage`. Modern Cross-Origin-Opener-Policy on the Supabase functions origin frequently blocks `window.opener.postMessage(...)` and even `window.close()`, so the parent never hears back and never re-checks status. `StravaConnect` already has a polling fallback; `GoogleFitConnect` does not.

## What I'll change

1. **`supabase/functions/google-fit-callback/index.ts`** and **`supabase/functions/strava-auth/index.ts`** (callback branch):
   - Build responses with `new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })` so the markup is never served as text.
   - Replace the bare `<html><body>…` strings with a small branded page: dark background (`#0b0613`), Bebas Neue heading via Google Fonts, a tick icon, "Connected — you can close this window" copy, and a manual "Close window" button as a fallback when `window.close()` is blocked.
   - Keep the `window.opener?.postMessage(...)` + `window.close()` script, wrapped in a try/catch.
   - Apply the same template (with appropriate copy) to the error/denied/expired branches so failures also look on-brand.

2. **`src/components/GoogleFitConnect.tsx`**:
   - Mirror the Strava pattern in `handleConnect`: open the popup, then start a `setInterval` that calls `checkStatus()` every 2 s and clears once `popup.closed` is true or after ~120 s. This guarantees the card flips to "Connected" even if `postMessage` is blocked by COOP.
   - Show a toast on the polled success path too (guarded so it only fires once).

3. **No DB, no auth, no onboarding-step logic changes.** The integrations step in `Onboarding.tsx` (line 513) keeps rendering the same two components — they just behave correctly now.

## Out of scope
- Restyling the onboarding "Integrations" step cards themselves.
- Replacing the popup flow with a same-window redirect (bigger change; can do later if you want).
- Strava-specific import UI tweaks.

## Files touched
- `supabase/functions/google-fit-callback/index.ts`
- `supabase/functions/strava-auth/index.ts` (callback HTML branch only)
- `src/components/GoogleFitConnect.tsx`

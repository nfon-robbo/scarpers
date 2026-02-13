

## Import Strava Activities from January 1st, 2026

The current import fetches activities page by page but doesn't specify a start date, so it only gets the most recent ones. The fix is to pass the `after` parameter (Unix timestamp) to the import function.

### Changes

**1. `src/components/StravaConnect.tsx`**
- Add `after: 1735689600` (Unix timestamp for Jan 1, 2026 00:00:00 UTC) to the request body in `handleImport`
- This tells the Strava API to return activities after that date

The backend edge function (`strava-import`) already supports the `after` parameter -- it just needs to be sent from the frontend.

### Technical Detail

The single change is in the `handleImport` function's `body: JSON.stringify(...)` call, adding `after: 1735689600` alongside the existing `page`, `per_page`, and `activity_types` fields. The Strava API's `after` parameter is an epoch timestamp that filters to activities recorded after that time.



# New Android API Endpoint for Plan Generation and Q&A

## Overview
Create a new backend function (`android-coach`) that provides a non-streaming, JSON-response API for your Android app. It will reuse the same AI logic and data access as the existing `ai-coach` but return a simple JSON object instead of SSE streaming.

## Authentication
Use a shared API key approach: your Android app sends a static secret key in the header, and the function validates it. This avoids requiring Android users to have accounts in this web app.

Alternatively, if your Android app users DO have accounts here, we can use their auth token. I'll implement the API key approach since it's simpler for a standalone app.

## New Edge Function: `supabase/functions/android-coach/index.ts`

**Endpoint:** `POST /functions/v1/android-coach`

**Request format (JSON):**
```text
{
  "api_key": "<your secret>",
  "type": "training-plan" | "chat",
  
  // For training-plan:
  "race_distance": "5k" | "10k" | "half-marathon" | "marathon",
  "training_days": ["Mon", "Wed", "Fri", "Sat"],
  "start_date": "2026-03-01",
  "race_date": "2026-06-01",   // or "ai-recommend"
  
  // For chat:
  "message": "Should I run today?",
  
  // Optional athlete context (since Android app may not have Supabase profile):
  "athlete": {
    "name": "John",
    "sport": "running",
    "experience": "intermediate",
    "goals": "finish half marathon",
    "context": "mild knee pain, prefer low impact"
  },
  
  // Optional activity/metrics data from your app:
  "activities": [...],
  "metrics": [...]
}
```

**Response format (JSON):**
```text
{
  "success": true,
  "type": "training-plan",
  "content": "## Season Strategy Overview\n..."
}
```

## Implementation Details

### 1. Create the edge function (`supabase/functions/android-coach/index.ts`)
- CORS headers for cross-origin access
- Validate `api_key` against a stored secret (`ANDROID_API_KEY`)
- Accept athlete profile + optional activity data in the request body (no database lookup needed)
- Reuse the same system/user prompts from `ai-coach` for plan generation and chat
- Call Lovable AI Gateway with `stream: false` for a simple JSON response
- Return the AI content as a JSON object
- Handle 429/402 rate limit errors

### 2. Add secret: `ANDROID_API_KEY`
- A secret key you generate and embed in your Android app
- The function validates this on every request

### 3. Update `supabase/config.toml`
- Add `[functions.android-coach]` with `verify_jwt = false` (since auth is via API key, not JWT)

### 4. Supported request types
- **`training-plan`**: Full plan generation with the same detailed prompts (workout tables, HR zones, BPM targets, periodization)
- **`chat`**: Quick Q&A with the same brevity rules (3-5 bullets, under 150 words)

## What your Android app needs to do
1. Store the API key securely
2. POST to `https://datdwxsugeobqigtopnz.supabase.co/functions/v1/android-coach`
3. Parse the JSON response and display the `content` field (it's markdown)

## Technical Notes
- Non-streaming means the response may take 10-30 seconds for plan generation (the AI generates the full plan before responding)
- Chat responses will be faster (2-5 seconds)
- The function does NOT access the database -- all athlete data comes from the Android app's request body, making it fully standalone

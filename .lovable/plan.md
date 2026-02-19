
# Make AI Responses Concise and Cost-Effective

## Problem
The AI coach responses are too long and verbose, wasting credits and making it harder to quickly digest advice.

## Changes

### 1. Chat prompt (`supabase/functions/ai-coach/index.ts`, ~line 331)
Add strict brevity rules to the chat system prompt:
- Maximum 3-5 bullet points per answer
- No long paragraphs — bullet points only
- Lead with the answer, then supporting data
- Total response under 150 words
- Only use headers if the user asks a complex multi-part question

### 2. Analysis prompt (`supabase/functions/ai-coach/index.ts`, ~line 351)
Tighten the analysis prompt:
- Each section limited to 3-5 bullet points max
- No prose paragraphs — data points and recommendations only
- Recommendations: one bullet per action, no elaboration unless critical
- Cut total output by roughly 50%

### 3. Plan review prompt (~line 399)
- Add word limits to each section (e.g., Progress Summary: 3-4 bullets, Coach's Notes: 2-3 sentences)
- Remove redundant elaboration instructions

### 4. Day-adjust prompt (~line 270)
- Coach's Note: limit to 1-2 sentences (currently uncapped)
- Sleep assessment: 2-3 bullets max

No frontend changes needed — this is purely backend prompt tuning.

## Technical Details
- File: `supabase/functions/ai-coach/index.ts`
- Affected prompt types: `chat`, `analysis`, `plan-review`, `day-adjust`
- Redeploy the `ai-coach` edge function after changes

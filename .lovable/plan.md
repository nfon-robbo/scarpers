Goal

Make the 48h dialog show the same numbers as the dashboard tile (Now %, hours awake, Awake drain, Activity drain), and rebuild the body-battery-insight edge function with strict prompts and Zod validation.

1. Edge function — supabase/functions/body-battery-insight/index.ts (complete rewrite)

Replace current implementation with:

- CORS via import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

- Auth: validate Bearer token via createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization } } }) + auth.getUser(). Return 401 if missing.

- Body validation with Zod (npm:zod):

  - percent, startPercent, hoursAwake, sleepHours, deepPct, remPct, drainAwake, drainActive → number

  - status, hrvVsBaseline, pattern → string

  - prevSleep → optional { hours: number, deepPct: number, remPct: number } or null

  - Return 400 with { error: <flattened Zod errors> } on validation failure

- AI call via AI SDK (use this approach, not the existing callAI helper):

```typescript

import { generateText } from "npm:ai";

import { createOpenAICompatible } from "npm:@ai-sdk/openai-compatible";

const provider = createOpenAICompatible({

  name: "lovable",

  baseURL: "[https://ai.gateway.lovable.dev/v1](https://ai.gateway.lovable.dev/v1)",

  headers: {

    "Lovable-API-Key": Deno.env.get("LOVABLE_API_KEY")!,

    "X-Lovable-AIG-SDK": "vercel-ai-sdk",

  },

});

const { text } = await generateText({

  model: provider("google/gemini-3-flash-preview"),

  system: SYSTEM_PROMPT,

  prompt: userPrompt,

  maxTokens: 300,

});

```

- System prompt (exact wording):
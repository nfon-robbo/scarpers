- Surfaces 402/429 to the client as { error, code } so the UI can render a fallback.

- Deployed via supabase--deploy_edge_functions after writing.

supabase/config.toml — no change needed (defaults apply).

2. Wire UI in BodyBattery48hDialog.tsx

After data loads (after setTotals), compute the chart "pattern" string from points:

```typescript

// Pattern detection logic

const q1Avg = points.slice(0, Math.floor(points.length/4))

  .reduce((sum, p) => sum + p.battery, 0) / Math.floor(points.length/4);

const midAvg = points.slice(Math.floor(points.length/3), Math.floor(2*points.length/3))

  .reduce((sum, p) => sum + p.battery, 0) / Math.floor(points.length/3);

const q4Avg = points.slice(Math.floor(3*points.length/4))

  .reduce((sum, p) => sum + p.battery, 0) / (points.length - Math.floor(3*points.length/4));

// Find largest hour-over-hour drop

const maxDrop = points.slice(1).reduce((max, p, i) => {

  const drop = points[i].battery - p.battery;

  return drop > max.drop ? { drop, hour: p.timestamp } : max;

}, { drop: 0, hour: null });

let pattern = '';

if (q4Avg > q1Avg + 10) pattern = "recharged overnight then steady";

else if (q1Avg - q4Avg > 30) pattern = "started high, gradual decline";

else if (Math.abs(q4Avg - q1Avg) < 10) pattern = "mostly flat";

else if (q4Avg > midAvg + 10 && midAvg < q1Avg) pattern = "dipped low then recovered";

else if (q4Avg > q1Avg) pattern = "climbing through the day";

else if (q4Avg < 30) pattern = "low and staying low";

else pattern = "gradual decline";

if (maxDrop.drop > 15) {

  const hour = new Date(maxDrop.hour).getHours();

  pattern += `, big drop around ${hour}:00`;

}

```

- Derive hrvVsBaseline string from readinessData.hrv and hrvBaseline: 

```typescript

  const hrvVsBaseline = !readinessData.hrv || !hrvBaseline 

    ? "n/a"

    : Math.abs(readinessData.hrv - hrvBaseline) / hrvBaseline < 0.05

    ? "baseline"

    : readinessData.hrv > hrvBaseline

    ? `+${Math.round((readinessData.hrv - hrvBaseline) / hrvBaseline * 100)}%`

    : `${Math.round((readinessData.hrv - hrvBaseline) / hrvBaseline * 100)}%`;

```

- Derive prevSleep from stages aggregated by date for the night before last (if present in 48h window).

- New insight state: { loading: boolean; text: string | null; error: string | null }.

- useEffect triggered after totals + truth-percent are set; calls supabase.functions.invoke("body-battery-insight", { body: {...} }). Single call per dialog open (key on open + readinessData?.wakeTimeIso).

- Fallback string when error: `Your battery is at ${percent}% after ${hoursAwake}h awake today.`

3. UI section (above legend / dialog footer)

New card placed between the 48h chart container and the existing legend row:

```tsx

<div className="rounded-lg border border-primary/20 bg-primary/5 p-3">

  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-primary font-medium">

    <Sparkles className="w-3.5 h-3.5" /> What's happening

  </div>

  {loading ? (

    <div className="mt-1.5 text-sm text-muted-foreground flex items-center gap-2">

      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Analysing your pattern…

    </div>

  ) : (

    <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">{text}</p>

  )}

</div>

```

- Sparkles from lucide-react.

- Card uses semantic tokens (primary), matches dialog styling. No new colours.

Out of scope

- Caching insights to the DB (each open triggers a fresh call; cheap with Gemini Flash).

- Streaming the response (not worth the complexity for 2–4 sentences).

- Edits to readiness math, body-battery formula, or the chart itself.

Acceptance

- Dialog open → spinner appears below chart, replaced within ~2s with a 2–4 sentence personalised paragraph that references the user's actual numbers.

- Network failure / 402 / 429 → fallback sentence renders with the live percent and hours awake.

- No LOVABLE_API_KEY ever appears in the bundle; the call goes only through the edge function.
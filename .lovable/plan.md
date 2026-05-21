# Fix Readiness gauge: invisible score + overflowing caption

Two bugs from the recent visual refresh, both in `src/components/ReadinessWidget.tsx`.

## Bug 1 — Score number invisible
The gradient text trick (`bg-clip-text text-transparent` + inline `backgroundImage`) is rendering the "32" as near-invisible.

**Fix:** drop the gradient. Render the score with a solid `text-foreground` and a soft drop-shadow for depth:
```tsx
<span className="text-6xl font-black tracking-tighter leading-none text-foreground"
      style={{ textShadow: "0 2px 16px hsl(var(--foreground) / 0.15)" }}>
  {score}
</span>
```
Also drop one size step (text-7xl → text-6xl) so the number sits comfortably inside the 210px gauge with the status pill underneath.

## Bug 2 — Caption text overlapping the tick arc
The gauge centre is currently stacking: score → status+trend → insight icon → driver text → message text → optional review link. That's 5–6 rows inside a ~150px circle, so the bottom lines render over the ticks.

**Fix:** keep only score + status + trend INSIDE the gauge. Move the driver line, message line, and review-plan button OUT to a caption block rendered immediately BELOW the gauge in the existing left column. The insight icon moves down with the driver text (inline beside it, e.g. `🌙 Deep sleep low`).

### New `CircularGauge` content
```
[score]                ← solid foreground, text-6xl
STATUS  ↗ +3           ← status uppercase in band colour, trend chip
```
No more `subNode` / `insightIcon` props rendered inside the circle.

### New caption block (sibling under the gauge)
```tsx
<div className="mt-1 flex flex-col items-center gap-1 text-center px-4">
  {driver && (
    <div className="flex items-center gap-1.5 text-[12px] font-medium text-foreground/85">
      {insightIcon}
      <span>{driver}</span>
    </div>
  )}
  <p className="text-[11px] text-muted-foreground leading-snug max-w-[240px]">{message}</p>
  {showReview && onReviewPlan && (
    <button …>Review today's plan →</button>
  )}
</div>
```

This gives the caption proper breathing room and zero overlap with the tick arc, while keeping the visual hierarchy from the previous redesign (number → status → trend → key insight → coaching line).

## Out of scope
- No changes to scoring, palette tokens, band logic, sparklines, ZoneBar, factor list, hourly trend chart, or the rest of the widget.
- `subNode` prop on `CircularGauge` becomes unused — remove it from the type and the call site.

## Files
- `src/components/ReadinessWidget.tsx` — edit `CircularGauge` (drop gradient text, drop `subNode`/`insightIcon` rendering inside), and edit the parent IIFE where the gauge is rendered to add the new caption block as a sibling below the gauge.

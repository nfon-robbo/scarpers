# Readiness Widget Visual Refresh

Purely a presentation refresh for `src/components/ReadinessWidget.tsx`. No changes to scoring, data fetching, AI calls, or persistence — only the gauge, header area, colour palette, and microcopy.

## What changes

### 1. Softer status palette
Replace the harsh red/amber/yellow/green scale used by `CircularGauge` (and the small status pill underneath) with a less alarming, contextual palette:

| Band | Label | Colour (HSL) |
|------|-------|--------------|
| 0–40 | Poor | amber `38 92% 55%` |
| 40–60 | Low | warm yellow-orange `45 95% 58%` |
| 60–75 | Medium | amber→green blend `75 70% 50%` |
| 75–85 | Good | green `142 65% 48%` |
| 85+ | Excellent | bright green `142 75% 52%` |

Tokens added to `src/index.css` as `--readiness-poor / low / medium / good / excellent` (HSL triplets) and consumed via inline `hsl(var(--...))` in the SVG so we keep our design-system rule of no raw hex in components.

### 2. Gauge redesign (`CircularGauge`)
- Thicker tick strokes (3px), longer active ticks for emphasis.
- Smooth `<linearGradient>` arc behind the ticks for the active portion (start→end of the current band) instead of a flat colour.
- Subtle outer glow (`drop-shadow`) using the active band colour at ~25% alpha.
- Faint reference dots at 25 / 50 / 75 positions.
- Animate the filled tick count from previous → current score on update (simple `requestAnimationFrame` tween over ~600ms, no new dependency).
- `aria-label` set to `"Readiness ${score} out of 100, ${statusLabel}"`.

### 3. Visual hierarchy in centre stack
```
   88                ← text-7xl, font-black, tracking-tighter, gradient text
   Medium  ↗ +3      ← text-xs uppercase, band colour at 90%, trend chip beside
   🌙 Deep sleep low ← text-[11px] muted, icon from lucide (Moon/Heart/Activity)
   Focus on recovery today  ← text-[11px] muted-foreground
```
- Score uses `bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-transparent`.
- Trend arrow derived from existing `trendSnapshots` — compare current score to the previous snapshot of the same kind: `↗` (+3 or more), `→` (within ±2), `↘` (−3 or more). Already-loaded data, no new query.
- Key-insight icon picked from the top non-good factor: Sleep Quality/Deep Sleep → `Moon`, HRV/Resting HR → `Heart`, Today's Effort/Yesterday's Load → `Activity`, fallback → `Sparkles`.

### 4. Friendlier messaging
Rewrite the band copy currently rendered under the gauge (`subNode`) so it reads like a coach, not an alarm:

| Band | Old | New |
|------|-----|-----|
| Poor | "Prioritise recovery now" | "Focus on recovery today" |
| Low | "Take it easy" | "Easy day recommended" |
| Medium | "Moderate effort OK" | "Moderate session is fine" |
| Good | "Ready to train" | "Good to go" |
| Excellent | "Peak readiness" | "Peak day — push if you want" |

Microcopy lives in a small `bandCopy(score)` helper at the top of the file.

### 5. Layout & spacing
- Increase vertical gap between the score, status pill, and insight line (`mt-3` → `mt-4`, etc.) so the number breathes.
- Centre-align the score; left-align the insight + message block at ~60% width under the gauge for the "left-of-centre" feel from the brief.
- Responsive: gauge size driven by container — `size = 200` on `<sm`, `220` on ≥`sm`. Uses a `useMediaQuery`-style check on mount (no new dep — inline `matchMedia`).

### 6. Accessibility
- Gauge gets `role="img"` + `aria-label`.
- Trend chip gets `aria-label="Trend: improving by 3 points"` etc.
- Insight icon `aria-hidden`, text carries the meaning.

## What does NOT change
- `computeReadiness` logic, scoring weights, factor calculations.
- Data fetching, caching, AI insight calls, sparklines, ZoneBar, factor list, body battery dialog, hourly trend chart.
- Public component props.

## Files
- `src/components/ReadinessWidget.tsx` — replace `CircularGauge`, tweak the parent render block that supplies `statusLabel` / `subNode`, add `bandCopy` and `bandColor` helpers, add trend arrow + insight icon picker.
- `src/index.css` — add 5 readiness band tokens.

## Out of scope (called out so we don't silently expand)
- Hover-to-reveal factor breakdown panel — listed as "optional" in the brief; skipped unless you want it.
- 7-day sparkline under the score — we already render full trend charts lower in the widget, adding another would duplicate.
- "Best this week" badge — needs a separate query; skipping unless requested.

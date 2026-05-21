## Restructure Readiness widget layout

Single file: `src/components/ReadinessWidget.tsx`.

### 1. Convert outer wrapper to a vertical stack

Line 1069 currently opens `<div className="flex flex-col md:flex-row gap-5">` directly around the two columns. Wrap it in an outer vertical container:

```
<div className="flex flex-col gap-5">
  <div className="flex flex-col md:flex-row gap-5"> ← top row (gauge + factors)
    ...
  </div>
  ← trend chart goes here, full width
</div>
```

### 2. Move the Readiness Trend block

The trend block lives inside the left column at lines ~1114–1386 (the big IIFE that renders `<div className="rounded-xl bg-[#111a2e] border border-border/30 p-3">` with the End of day / Morning / Today tabs and chart).

- Cut that entire IIFE out of the left column.
- Paste it as a sibling **below** the two-column row, inside the new outer wrapper.
- Keep the `(hasTrend || trendMode === "today")` guard intact.
- No prop or state changes — `trendMode`, `visibleTrend`, `wakeHour`, etc. are already component-level.

### 3. Let the Today chart breathe

Inside the Today branch, the `ResponsiveContainer` is set to `height={160}`. Since it now spans the full card width, bump the height so the 30+ hourly snapshots are readable — `height={220}` and keep `width="100%"`. No other chart math changes; x/y domains already scale.

### 4. Remove "Recovery Focus today"

Delete the IIFE at lines ~1553–1620 (the block starting `// ── Recovery Focus — top 1-2 marching orders ──` and ending with its closing `})()}`), plus the `ORDERS` map inside it. No other references — `Sparkles` is still used by the key-insight row at line 1043, so keep the import.

### 5. Let the factors column flex naturally

Right column currently uses `flex-1 min-w-0` (line 1388) — no change needed; with the trend gone from the left side and the gauge column fixed at `md:w-[300px]`, the factors list takes the rest of the row and stacks cleanly on mobile.

### Result

- Top row: gauge + caption (left, 300px) · factors list (right, fills).
- Bottom: full-width Readiness Trend card with tabs and a taller Today chart.
- Recovery Focus removed (key insight under the gauge already covers it).
- Mobile: stacks gauge → factors → trend (same `flex-col` behaviour at < md).

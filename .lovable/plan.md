Fix readiness trend tooltip showing "Hidden". Two Tooltip components in src/components/ReadinessWidget.tsx have a formatter that hardcodes the value as "Hidden". Replace both with a formatter that renders the actual rounded score.

Changes: In src/components/ReadinessWidget.tsx line 1160 (main hourly snapshots chart) change formatter to: formatter={(value: any) => [Math.round(Number(value)), "Readiness"]}

In src/components/ReadinessWidget.tsx line 1238 (secondary trend chart) change formatter to: formatter={(value: any) => [Math.round(Number(value)), "Readiness"]}

Result: tooltip shows Time: 21:45 / Readiness: 61 instead of Readiness: Hidden. No other logic, styling, or data flow changes.
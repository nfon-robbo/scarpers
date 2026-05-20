Fix Body Battery draining too gently. Two changes in src/lib/body-battery.ts plus a matching tweak in the 48h chart simulation.

In src/lib/body-battery.ts:

1. Bump passiveDrainRate thresholds: 0-4h awake to 3 pts/hr (was 2), 4-8h to 4 (was 3), 8-12h to 5 (was 4), 12h+ to 6 (was 5).
2. In computeBodyBattery, after summing active from logged activities, add an ambient drain: const ambient = hoursAwake * 0.5; const rawPercent = startPercent - passive - active - ambient; Fold ambient into drainActive so the UI still shows it as activity: drainActive = active + ambient.

In src/components/BodyBattery48hDialog.tsx:

passiveDrainForHour already delegates to passiveDrainRate, so the rate bump flows through automatically. To keep the 48h curve in sync with the new ambient term, add a 0.5 pts/hr ambient drain in the awake branch around line 223: const ambient = 0.5; const ambientD = (ambient * stepMin) / 60; delta -= ambientD; if (lastWakeMs != null && t >= lastWakeMs) tot.drainActive += ambientD;

Result: 15h awake with light activity gives approximately 70 passive + 7.5 ambient + small logged drain = 20-25% remaining battery. No other logic, status thresholds, or insight strings change.
## Temporarily expose Body Battery debug log in production

In `src/lib/body-battery.ts`, remove the `import.meta.env?.DEV` gate around the two `console.debug` calls inside `computeBodyBattery` so they run in production builds as well.

### Change

Replace:

```ts
if (import.meta.env?.DEV) {
  const s = opts.sleep;
  console.debug("[BodyBattery] inputs:", { ... });
  console.debug(`[BodyBattery] start=${startPercent}  passive=...`);
}
```

With the same two `console.debug` calls, unconditionally (keep the `const s = opts.sleep` line).

### After you confirm

Once you've captured the output from DevTools → Console after clicking Recompute, I'll put the gate back (or remove the logs entirely — your call).

### Files

- `src/lib/body-battery.ts` — remove the DEV gate around the two debug logs (no formula changes)

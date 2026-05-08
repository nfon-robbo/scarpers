## Goal
Replace the hero image carousel with a generated video clip of a plus-size woman running on a residential street, glancing at her watch.

## Step 1 — Generate the video
Use `videogen` to create a 10s, 1080p, 16:9 MP4.

**Prompt:**
> Cinematic side-tracking shot of a plus-size woman in her 30s jogging down a quiet tree-lined residential street, wearing modern running clothes (leggings, fitted top) and trainers. Determined expression, breathing steady. Around the 4-second mark she briefly glances down at her sports watch on her left wrist, then looks back up and keeps running. Soft morning sunlight, warm cinematic colour grade, gentle handheld camera, shallow depth of field, realistic body proportions, motivational tone.

Saved to `src/assets/hero-runner.mp4`.

## Step 2 — Swap carousel for video in `src/pages/Landing.tsx`
- Remove the `HERO_IMAGES` array, `heroIdx` state, and the rotating `setInterval` effect.
- Remove the four imported runner images (`heroRunner`, `heroRunner2/3/4`).
- Import the new MP4 and render a single `<video>` with `autoPlay muted loop playsInline preload="auto"` and a poster (still frame from the first hero image kept as fallback) covering the same `absolute inset-0` slot.
- Keep the existing black overlay and gradient overlays so the white headline stays readable.
- Keep the white `<h1>` and subtitle styling untouched.

## Step 3 — Verify
- Confirm the video renders full-bleed behind the hero.
- Confirm the overlay still gives enough contrast for "Free AI Running Plan" + subtitle.
- Confirm there are no leftover references to the removed image imports.

## Notes
- Video will be ~5–10 MB at 1080p/10s; acceptable for a hero. If too heavy we can drop to 480p in a follow-up.
- The video loops silently — no audio track is used.
- Old runner images stay in `src/assets/` only if reused elsewhere; otherwise they can be deleted in a follow-up.
## SEO overhaul

### 1. Meta tags (`index.html`)
- **Title**: `Scarpers — AI Running Coach | Free Personalised 5K & 10K Training Plans`
- **Meta description**: `Scarpers uses AI to generate personalised running plans built around your fitness level, injury history, HR zones and race goal. Get your free 5K or 10K training plan today.`
- Mirror into Open Graph + Twitter title/description.
- Update `SoftwareApplication` JSON-LD slightly (keep `HealthApplication` category) and add a new `FAQPage` JSON-LD node mirroring landing FAQ.

### 2. Landing hero (`src/pages/Landing.tsx`)
- H1: `AI Running Coach`
- Subline (directly under H1): `Free personalised running plans for 5K, 10K, half, marathon & ultra — built around your fitness, injuries and goals.`
- Existing paragraph copy stays.

### 3. FAQ section on landing
- New `<section id="faq">` before footer using existing `CollapsibleSection` styling.
- Questions:
  1. What is Scarpers?
  2. Is Scarpers free?
  3. How does the AI generate my plan?
  4. Can I use Scarpers if I have an injury?
  5. Does Scarpers work with Garmin watches?
  6. What running distances does Scarpers support?
  7. Is Scarpers suitable for complete beginners?
  8. How is Scarpers different from Couch to 5K?
- Same Q&A pairs rendered as `FAQPage` JSON-LD in `index.html`.

### 4. New public pages (added to `src/App.tsx` outside `ProtectedRoute`)

**`/5k-training-plan`** — long-form (~500+ words). H1: `Free Personalised 5K Training Plan`. Sections:
- What the plan includes (week-by-week structure, easy runs, intervals, long runs, rest)
- How it adapts to your current fitness from imported activities
- Injury-aware programming (uses onboarding injury history to scale volume / swap impact sessions)
- HR zone training (5-zone model, target zones per session)
- Garmin sync (FIT import / Intervals.icu export so workouts appear on the watch)
- CTA to `/auth`

**`/10k-training-plan`** — long-form (~500+ words). H1: `Free Personalised 10K Training Plan`. Same structural sections tuned to 10K: building aerobic base, threshold work, race-pace long runs, taper, plus adaptation/injury/HR/Garmin sections. CTA to `/auth`.

**`/ai-running-coach`** — long-form (~500+ words). H1: `AI Running Coach`. Sections:
- How the AI builds your plan (onboarding inputs + activity history + readiness)
- What data it uses (FIT files, Strava, HR, sleep, readiness, Running IQ)
- Day-ahead briefings and post-workout reviews
- How it differs from a human coach (instant, 24/7, data-driven, free; complements rather than replaces elite human coaching)
- CTA to `/auth`

**`/blog`** — minimal "Coming soon" intro page with H1 `Scarpers Running Blog`. Includes `<meta name="robots" content="noindex, follow" />` injected via a small effect (or React Helmet-style direct `document` manipulation matching existing pattern) until real posts exist.

All marketing pages share a lightweight header (logo + Sign in link) and footer matching Landing styling. No new colors — uses existing semantic tokens.

### 5. Sitemap & robots (static files exist — edit in place)
- `public/sitemap.xml`: include `/`, `/5k-training-plan`, `/10k-training-plan`, `/ai-running-coach`, `/auth`, `/privacy`. Omit `/blog` (noindex). Update `lastmod` to today (UK date format internally, ISO in XML).
- `public/robots.txt`: keep existing structure, ensure new marketing routes are crawlable (they already are via default `Allow: /`), add `Disallow: /blog`. Sitemap line already correct.
- Sitemap will be served at `https://www.scarpers.co.uk/sitemap.xml` via the existing static file (already working).

### 6. Structured data (`index.html`)
- Keep `Organization`, `WebSite`, `SoftwareApplication`.
- Add `FAQPage` graph entry with all 8 FAQ Q&A pairs so Google can show rich FAQ results.

### Notes
- Marketing/SEO-only changes. No backend, database, or business-logic edits.
- All new pages indexable; `/blog` explicitly noindexed until content lands.

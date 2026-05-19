## Context — what's already working

Audited the project against the user's checklist. Most items are already done:

- **robots.txt** exists at `public/robots.txt` with `Sitemap:` directive pointing at `https://www.scarpers.co.uk/sitemap.xml`. Public pages are crawlable; only logged-in app routes are disallowed.
- **Per-page meta** (title, description, canonical, OG, Twitter) is handled by `MarketingPageLayout` for every marketing route (Landing, Blog, BlogPost, About, Coach, 5K/10K plans, AI coach, Privacy, Terms).
- **JSON-LD**: Organization + WebSite + SoftwareApplication in `index.html`; Article + BreadcrumbList already injected per blog post in `src/pages/BlogPost.tsx`.
- **No `noindex`** on public pages. Auth gating only applies to app routes (already in robots disallow list).
- **Internal linking** from blog index → posts exists; post → related/plan links exist in MarketingPageLayout footer/nav.

## The actual problem

`public/sitemap.xml` is a **hand-maintained static file** and is stale:

- Lists only 3 blog posts. Database has **7 published posts** — missing: `ultimate-guide-personalised-running-plan`, `how-to-start-10k-training-plan`, `the-runner-s-guide-to-speed-training-and-running-economy`, `what-is-an-ai-running-coach`.
- `lastmod` dates are all frozen at 2026-05-12.
- Every new blog post needs a manual sitemap edit, which is why posts aren't being discovered.

That's the single root cause for the indexing gap. Fix the sitemap → Google discovers all posts on next crawl.

## Plan

### 1. Auto-generate `public/sitemap.xml` at build time

Create `scripts/generate-sitemap.ts` that:

- Defines static marketing routes (`/`, `/about`, `/coach/claire-rayners`, `/ai-running-coach`, `/5k-training-plan`, `/10k-training-plan`, `/blog`, `/privacy`, `/terms`).
- Fetches all published blog posts from Supabase using the public anon key (URL + anon key already injected via `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env`), filtered by `published = true` and `published_at <= now()` — same filter as `src/pages/Blog.tsx`.
- Uses each post's `updated_at` (fallback `published_at`) as `<lastmod>` so recent edits prioritise correctly.
- Writes `public/sitemap.xml` with `BASE_URL = "https://www.scarpers.co.uk"` (canonical domain per memory).
- Keeps the existing `<image:image>` block on the homepage entry.

Wire it into `package.json`:

```json
"predev": "bunx tsx scripts/generate-sitemap.ts",
"prebuild": "bunx tsx scripts/generate-sitemap.ts"
```

Graceful fallback: if the Supabase fetch fails (offline build), log a warning and emit the static routes only — never crash the build.

### 2. Tidy `public/robots.txt` (minor)

No structural change; keep all existing `Disallow` rules. Just confirm the `Sitemap:` line stays pointing at the canonical `https://www.scarpers.co.uk/sitemap.xml`. No edit needed unless the user wants the preview/lovable-app mirror also listed (recommend not).

### 3. Re-submit sitemap to Google Search Console

After deploy, ping GSC so it re-crawls. Either:
- User clicks "Submit" in GSC UI for `https://www.scarpers.co.uk/sitemap.xml`, **or**
- I can curl the GSC API (`PUT /webmasters/v3/sites/<site>/sitemaps/<sitemap-url>`) via the existing Google Search Console connector to trigger submission programmatically.

I'll do the API submission automatically after the build so the user doesn't have to.

## What I am NOT changing (and why)

- **Meta tags, canonicals, OG, JSON-LD** — already correct on every public route. Re-implementing would be churn.
- **`react-helmet-async`** — not needed; `MarketingPageLayout`'s effect-based head management already works for Googlebot (which executes JS) and the static `index.html` head covers non-JS social crawlers.
- **No new `<Article>` JSON-LD plumbing** — `BlogPost.tsx` already injects it.
- **No new internal links** — existing structure (blog index → posts, footer nav across all pages) is sufficient for crawling.

## Files touched

- `scripts/generate-sitemap.ts` (new)
- `package.json` (add `predev`/`prebuild` scripts; add `tsx` devDep if missing)
- `public/sitemap.xml` becomes generator output (committed but auto-overwritten)

## Expected outcome

Next deploy → fresh sitemap with all 7 (and future) blog posts + accurate `lastmod` → GSC re-crawls within days → indexed page count rises from 3 toward 16+.

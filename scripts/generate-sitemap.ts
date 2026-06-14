// Generates public/sitemap.xml from the route list + published blog posts.
// Runs before `vite dev` and `vite build` via predev/prebuild hooks.

import { writeFileSync } from "fs";
import { resolve } from "path";

const BASE_URL = "https://www.scarpers.co.uk";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://datdwxsugeobqigtopnz.supabase.co";
const SUPABASE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhdGR3eHN1Z2VvYnFpZ3RvcG56Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5NzQ5NjAsImV4cCI6MjA4NjU1MDk2MH0.VAXyG4I1v66-Jl3bM9GSw-aWNEi5Rv5SPLzj6d8ES6w";

interface SitemapEntry {
  path: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
  image?: { loc: string; title?: string };
}

const TODAY = new Date().toISOString().slice(0, 10);

const staticEntries: SitemapEntry[] = [
  {
    path: "/",
    lastmod: TODAY,
    changefreq: "weekly",
    priority: "1.0",
    image: { loc: `${BASE_URL}/og-image.png`, title: "Scarpers — AI Running Coach" },
  },
  { path: "/about", lastmod: TODAY, changefreq: "monthly", priority: "0.8" },
  { path: "/coach/claire-rayners", lastmod: TODAY, changefreq: "monthly", priority: "0.7" },
  { path: "/ai-running-coach", lastmod: TODAY, changefreq: "monthly", priority: "0.9" },
  { path: "/5k-training-plan", lastmod: TODAY, changefreq: "monthly", priority: "0.9" },
  { path: "/10k-training-plan", lastmod: TODAY, changefreq: "monthly", priority: "0.9" },
  { path: "/blog", lastmod: TODAY, changefreq: "weekly", priority: "0.8" },
  { path: "/compare/runna-alternative", lastmod: TODAY, changefreq: "monthly", priority: "0.7" },
  { path: "/compare/scampr-alternative", lastmod: TODAY, changefreq: "monthly", priority: "0.7" },
  { path: "/compare/strava-coach-alternative", lastmod: TODAY, changefreq: "monthly", priority: "0.7" },
  { path: "/compare/ai-endurance-alternative", lastmod: TODAY, changefreq: "monthly", priority: "0.7" },
  { path: "/privacy", lastmod: TODAY, changefreq: "yearly", priority: "0.3" },
  { path: "/terms", lastmod: TODAY, changefreq: "yearly", priority: "0.3" },
];

async function fetchBlogEntries(): Promise<SitemapEntry[]> {
  try {
    const nowIso = new Date().toISOString();
    const url = `${SUPABASE_URL}/rest/v1/blog_posts?select=slug,published_at,updated_at&published=eq.true&published_at=lte.${encodeURIComponent(
      nowIso,
    )}&order=published_at.desc`;
    const res = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = (await res.json()) as Array<{ slug: string; published_at: string; updated_at: string }>;
    return rows.map((r) => ({
      path: `/blog/${r.slug}`,
      lastmod: (r.updated_at || r.published_at || TODAY).slice(0, 10),
      changefreq: "monthly",
      priority: "0.7",
    }));
  } catch (err) {
    console.warn(`[sitemap] Could not fetch blog posts (${err}). Emitting static routes only.`);
    return [];
  }
}

function renderEntry(e: SitemapEntry): string {
  const lines = [
    `  <url>`,
    `    <loc>${BASE_URL}${e.path}</loc>`,
    e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
    e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
    e.priority ? `    <priority>${e.priority}</priority>` : null,
    e.image ? `    <image:image>\n      <image:loc>${e.image.loc}</image:loc>${e.image.title ? `\n      <image:title>${e.image.title}</image:title>` : ""}\n    </image:image>` : null,
    `  </url>`,
  ];
  return lines.filter(Boolean).join("\n");
}

async function main() {
  const blog = await fetchBlogEntries();
  const entries = [...staticEntries, ...blog];

  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"`,
    `        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">`,
    ...entries.map(renderEntry),
    `</urlset>`,
    ``,
  ].join("\n");

  writeFileSync(resolve("public/sitemap.xml"), xml);
  console.log(`[sitemap] wrote public/sitemap.xml (${entries.length} entries, ${blog.length} blog posts)`);
}

main();

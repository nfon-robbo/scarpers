import { useEffect, useMemo } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import MarketingPageLayout from "@/components/MarketingPageLayout";
import { Check, X, Minus } from "lucide-react";

const LAST_UPDATED_ISO = "2026-05-22";

type Row = { feature: string; scarpers: boolean | "partial" | string; competitor: boolean | "partial" | string };
type FAQ = { q: string; a: string };

type CompareData = {
  slug: string;
  competitor: string;
  competitorShort: string;
  competitorUrl: string;
  oneLiner: string;
  competitorOneLiner: string;
  table: Row[];
  scarpersBetter: string[];
  competitorBetter: string[];
  switchReason: string;
  faqs: FAQ[];
  metaTitle: string;
  metaDescription: string;
};

const DATA: Record<string, CompareData> = {
  "runna-alternative": {
    slug: "runna-alternative",
    competitor: "Runna",
    competitorShort: "Runna",
    competitorUrl: "https://www.runna.com",
    oneLiner: "Runna is a polished, subscription-based running coach app aimed at race-focused runners.",
    competitorOneLiner:
      "Runna offers structured race plans (5K through marathon) with Apple Watch and Garmin Connect integrations, guided audio runs, and strength sessions — typically £15–£20/month after a free trial.",
    table: [
      { feature: "Free 5K plan", scarpers: true, competitor: "Trial only" },
      { feature: "Free 10K plan", scarpers: true, competitor: "Trial only" },
      { feature: "Free half marathon & marathon plans", scarpers: true, competitor: "Paid" },
      { feature: "Personalised by your real data", scarpers: true, competitor: true },
      { feature: "AI day-ahead briefing & post-run review", scarpers: true, competitor: "partial" },
      { feature: "Direct Garmin FIT file import (no cloud middleman)", scarpers: true, competitor: false },
      { feature: "Strava import", scarpers: true, competitor: true },
      { feature: "Sends workouts to Garmin watch", scarpers: "Via Intervals.icu", competitor: true },
      { feature: "Guided audio runs", scarpers: "Via Garmin", competitor: true },
      { feature: "Strength & mobility programme", scarpers: "Via Garmin", competitor: true },
      { feature: "Injury history factored into plan", scarpers: true, competitor: "partial" },
      { feature: "Readiness-based daily adaptation", scarpers: true, competitor: "partial" },
      { feature: "Music BPM targets for cadence", scarpers: true, competitor: false },
      { feature: "Polished onboarding & brand", scarpers: "partial", competitor: true },
    ],
    scarpersBetter: [
      "It's free, including marathon plans — no trial that ends, no subscription.",
      "You can drop a Garmin FIT export (ZIP) straight in and own your data.",
      "Injury history is captured at onboarding and respected by the AI when building and adapting plans.",
      "Daily readiness (sleep + HRV + load) actually moves sessions up or down — not just a label on the dashboard.",
      "Workout titles, intensity descriptions and BPM targets are designed for runners who want the why, not just a green tick.",
    ],
    competitorBetter: [
      "Guided audio runs with a coach in your ear — Scarpers doesn't offer this.",
      "Built-in strength and mobility sessions inside the same app.",
      "Native watch face / workout push on more devices, with less setup.",
      "Bigger team, longer track record, more polished UX in some flows.",
      "Larger user base if community and social proof matter to you.",
    ],
    switchReason:
      "Most runners who tell us they're moving from Runna say the same thing: the plans were great, but the subscription stacked up with everything else, and they wanted to keep their training when they paused. Scarpers' free tier means your plan, history and AI coach are still there even if you take three months off.",
    faqs: [
      {
        q: "Is Scarpers really free?",
        a: "Yes. The 5K, 10K, half marathon and marathon plans, the AI coach, readiness scoring and Garmin FIT imports are all free with no credit card. Scarpers is built on Lovable Cloud, which keeps infrastructure costs low enough to offer the core product free.",
      },
      {
        q: "How is Scarpers different from Runna?",
        a: "Runna is a paid subscription with guided audio runs and strength workouts. Scarpers is free, focuses on plan personalisation from your own Garmin/Strava data, and is more transparent about the reasoning — every session shows target intensity, HR zone and BPM. There are no guided audio runs.",
      },
      {
        q: "Can I import my Garmin history?",
        a: "Yes. Download your full Garmin Connect export (a ZIP of FIT files) and drop it in — Scarpers parses GPS, HR, cadence and power locally and builds your training history from real data.",
      },
      {
        q: "Will Scarpers send workouts to my Garmin watch?",
        a: "Yes, via the Intervals.icu integration. You connect Intervals.icu once and structured sessions appear on your watch on the day they're scheduled.",
      },
      {
        q: "Does Scarpers do strength training?",
        a: "Not yet. If structured strength sessions inside the same app are a must-have, Runna is the better fit today.",
      },
    ],
    metaTitle: "Runna Alternative (Free) — Scarpers vs Runna Comparison 2026",
    metaDescription:
      "Looking for a free Runna alternative? Honest side-by-side comparison of Scarpers vs Runna — features, pricing, Garmin support and where each one wins.",
  },
  "scampr-alternative": {
    slug: "scampr-alternative",
    competitor: "Scampr",
    competitorShort: "Scampr",
    competitorUrl: "https://scampr.app",
    oneLiner: "Scampr is a newer AI-driven running coach app aimed at everyday runners building consistency.",
    competitorOneLiner:
      "Scampr generates AI training plans for 5K through marathon, with a clean mobile-first UI and a freemium pricing model that gates advanced features behind a subscription.",
    table: [
      { feature: "Free 5K plan", scarpers: true, competitor: "partial" },
      { feature: "Free 10K plan", scarpers: true, competitor: "partial" },
      { feature: "Free half & marathon plans", scarpers: true, competitor: "Paid tier" },
      { feature: "AI-built personalised plan", scarpers: true, competitor: true },
      { feature: "Reads your full running history", scarpers: "8 weeks deep", competitor: "partial" },
      { feature: "Garmin FIT (ZIP) import", scarpers: true, competitor: false },
      { feature: "Strava import", scarpers: true, competitor: true },
      { feature: "Google Fit / Health Connect sleep sync", scarpers: true, competitor: "partial" },
      { feature: "Daily readiness scoring (sleep + HRV + load)", scarpers: true, competitor: "partial" },
      { feature: "Auto plan adaptation when readiness drops", scarpers: true, competitor: "partial" },
      { feature: "Running IQ score (0–200)", scarpers: true, competitor: false },
      { feature: "AI day-ahead & post-run review", scarpers: true, competitor: "partial" },
      { feature: "Injury history captured at onboarding", scarpers: true, competitor: "partial" },
      { feature: "Sends workouts to Garmin watch", scarpers: "Via Intervals.icu", competitor: "partial" },
    ],
    scarpersBetter: [
      "All distances are free — 5K, 10K, half and full marathon — with no paywall on the plan itself.",
      "Deeper history ingestion: Scarpers analyses 8 weeks of running and 30 nights of sleep to write your plan, not just a recent snapshot.",
      "Garmin FIT ZIP import lets you bring decades of running history in one drop.",
      "Running IQ is a transparent 0–200 score built from five training pillars, so you can see what's actually improving.",
      "Readiness changes don't just appear on a dashboard — they automatically dial sessions down, and offer to dial up when you're trending well.",
    ],
    competitorBetter: [
      "Scampr's onboarding and UI are slick and minimal — great if you want fewer dials and dashboards.",
      "If you only run, only want a plan, and want as little detail as possible, Scampr's simplicity is a plus.",
      "Newer app with active iteration on mobile-first features.",
    ],
    switchReason:
      "Runners who message us about switching from Scampr usually want more transparency: they like the AI plan, but want to see why a session changed, what their fitness trend actually is, and have real Garmin data behind the recommendation rather than just recent activity.",
    faqs: [
      {
        q: "Is Scarpers really free?",
        a: "Yes — all training plans, the AI coach, readiness scoring, Running IQ and Garmin FIT imports are free with no credit card.",
      },
      {
        q: "How is Scarpers different from Scampr?",
        a: "Both use AI to build plans. Scarpers exposes more of the reasoning (Running IQ, readiness factors, HR zones, BPM targets), reads more historical data, and the full marathon plan is free rather than gated.",
      },
      {
        q: "Can I import everything from my Garmin Connect account?",
        a: "Yes. Download your Garmin export (a ZIP of FIT files) and drop it into Scarpers — GPS, HR, cadence, power and sleep are parsed locally.",
      },
      {
        q: "Will Scarpers replace Scampr's daily plan view?",
        a: "Yes. The dashboard shows today's session, an AI day-ahead briefing, and a post-run review once the activity syncs in.",
      },
    ],
    metaTitle: "Scampr Alternative (Free) — Scarpers vs Scampr Honest Comparison",
    metaDescription:
      "Looking for a free Scampr alternative? Honest comparison of Scarpers vs Scampr — AI plans, Garmin import, readiness scoring and where each one wins.",
  },
  "strava-coach-alternative": {
    slug: "strava-coach-alternative",
    competitor: "Strava (with Athlete Intelligence / paid plans)",
    competitorShort: "Strava",
    competitorUrl: "https://www.strava.com",
    oneLiner:
      "Strava is the dominant social tracking platform, with paid features for plans, segments and Athlete Intelligence summaries.",
    competitorOneLiner:
      "Strava's paid tier adds training plans, segment analysis, route building, and AI-generated activity summaries — but the plans are templates, not built around your individual data.",
    table: [
      { feature: "Free personalised training plans", scarpers: true, competitor: false },
      { feature: "Plan rebuilt from your real history", scarpers: true, competitor: "partial" },
      { feature: "Garmin FIT ZIP import (decades of history)", scarpers: true, competitor: "partial" },
      { feature: "Strava activity import", scarpers: true, competitor: true },
      { feature: "Social feed, kudos, segments", scarpers: false, competitor: true },
      { feature: "Route discovery & heatmaps", scarpers: false, competitor: true },
      { feature: "AI coach with day-ahead & post-run reviews", scarpers: true, competitor: "partial" },
      { feature: "Daily readiness score (sleep + HRV + load)", scarpers: true, competitor: false },
      { feature: "Auto plan adaptation when life happens", scarpers: true, competitor: false },
      { feature: "Running IQ score (0–200)", scarpers: true, competitor: false },
      { feature: "Injury history factored into plan", scarpers: true, competitor: false },
      { feature: "Music BPM cadence targets", scarpers: true, competitor: false },
      { feature: "Subscription required", scarpers: "Free", competitor: "Paid tier" },
    ],
    scarpersBetter: [
      "Free, personalised plans for 5K through marathon — Strava's plans are paid and template-based.",
      "Readiness, Running IQ and adaptation are all built in, not bolted on.",
      "Injury history is part of onboarding and respected by the AI.",
      "Direct Garmin FIT ZIP import gives you decades of history without going through Strava's API limits.",
    ],
    competitorBetter: [
      "Strava's social feed, kudos and friend network are unmatched — Scarpers has no social layer.",
      "Segments and leaderboards are a Strava-only product.",
      "Route discovery, heatmaps and global maps are far better on Strava.",
      "If you primarily want to share runs and find new routes, Strava is the right tool.",
    ],
    switchReason:
      "Most runners don't actually want to leave Strava — they want a real coach to sit alongside it. Scarpers imports your Strava activities automatically, so you can keep posting to your feed and let Scarpers handle the plan, readiness and review.",
    faqs: [
      {
        q: "Do I have to leave Strava to use Scarpers?",
        a: "No. Connect Strava once and your runs import automatically. Most runners use Strava for the social side and Scarpers for the coaching side.",
      },
      {
        q: "Is Scarpers really free vs Strava's paid plans?",
        a: "Yes. The AI coach, training plans, readiness scoring and Running IQ are all free with no credit card.",
      },
      {
        q: "How is Scarpers' AI different from Strava's Athlete Intelligence?",
        a: "Athlete Intelligence summarises what you did. Scarpers' AI also tells you what to do tomorrow, adapts the plan when readiness drops, and writes a structured post-run review tied to the goal of the session.",
      },
      {
        q: "Will my Strava activities count towards my Scarpers plan?",
        a: "Yes — Strava imports are deduplicated against FIT imports and feed straight into your 8-week training history.",
      },
    ],
    metaTitle: "Free Strava Coaching Alternative — Scarpers vs Strava Plans",
    metaDescription:
      "Want a free alternative to Strava's paid training plans? Honest comparison of Scarpers vs Strava — coaching, readiness, Garmin import and where each one wins.",
  },
  "ai-endurance-alternative": {
    slug: "ai-endurance-alternative",
    competitor: "AI Endurance",
    competitorShort: "AI Endurance",
    competitorUrl: "https://aiendurance.com",
    oneLiner:
      "AI Endurance is a long-running AI coaching platform for runners, cyclists and triathletes, with a strong focus on lab-style data analysis.",
    competitorOneLiner:
      "AI Endurance uses machine learning on your historical activities to generate plans and predict race performance, with a subscription model and a multi-sport focus.",
    table: [
      { feature: "Free 5K, 10K, half & marathon plans", scarpers: true, competitor: false },
      { feature: "Run-only focus", scarpers: true, competitor: false },
      { feature: "Multi-sport (run + bike + tri)", scarpers: false, competitor: true },
      { feature: "AI-built personalised plan", scarpers: true, competitor: true },
      { feature: "Garmin FIT ZIP import", scarpers: true, competitor: "partial" },
      { feature: "Strava import", scarpers: true, competitor: true },
      { feature: "Race time prediction", scarpers: true, competitor: true },
      { feature: "Running IQ score (0–200)", scarpers: true, competitor: false },
      { feature: "Readiness-based daily adaptation", scarpers: true, competitor: "partial" },
      { feature: "AI day-ahead briefing", scarpers: true, competitor: "partial" },
      { feature: "AI post-run review", scarpers: true, competitor: "partial" },
      { feature: "Injury history at onboarding", scarpers: true, competitor: "partial" },
      { feature: "Subscription required", scarpers: "Free", competitor: "Paid tier" },
    ],
    scarpersBetter: [
      "Free for all running distances — AI Endurance is subscription-based.",
      "Run-only focus means the AI's reasoning is tuned for running pillars: aerobic base, threshold, VO₂max, durability, economy.",
      "Running IQ exposes your fitness trend transparently rather than as a black-box prediction.",
      "Day-ahead briefings and post-run reviews are written in plain English and tied to today's session goal.",
    ],
    competitorBetter: [
      "If you train in multiple disciplines (cycling, triathlon), AI Endurance handles all of them in one plan — Scarpers doesn't.",
      "Longer track record of ML-driven plan generation.",
      "Some advanced lab-style analytics (e.g. critical power, FTP modelling for cycling) Scarpers doesn't attempt.",
    ],
    switchReason:
      "Runners moving from AI Endurance to Scarpers usually want a simpler, run-focused experience without a subscription, and prefer the day-by-day AI coach voice over a more analytical dashboard.",
    faqs: [
      {
        q: "Is Scarpers really free vs AI Endurance?",
        a: "Yes. All running plans, the AI coach, readiness scoring and Running IQ are free with no credit card.",
      },
      {
        q: "Does Scarpers do cycling or triathlon?",
        a: "Not currently. Scarpers is run-only by design. If you need a multi-sport plan, AI Endurance is the better fit.",
      },
      {
        q: "How accurate is Scarpers' race prediction vs AI Endurance?",
        a: "Scarpers blends your recent tempo, VO₂max sessions and easy-run efficiency with adherence and readiness, and refreshes the prediction as you train. Both tools are approximations — neither replaces a race-day rehearsal.",
      },
      {
        q: "Can I import my AI Endurance history?",
        a: "Indirectly — connect Strava (where most AI Endurance users sync activities) or drop in your Garmin FIT ZIP and Scarpers will rebuild your training history.",
      },
    ],
    metaTitle: "AI Endurance Alternative (Free) — Scarpers vs AI Endurance",
    metaDescription:
      "Looking for a free AI Endurance alternative? Honest comparison of Scarpers vs AI Endurance — features, pricing, run-only focus and where each one wins.",
  },
};

const Cell = ({ value }: { value: boolean | "partial" | string }) => {
  if (value === true) return <span className="inline-flex items-center gap-1 text-emerald-400"><Check className="w-4 h-4" /> Yes</span>;
  if (value === false) return <span className="inline-flex items-center gap-1 text-muted-foreground"><X className="w-4 h-4" /> No</span>;
  if (value === "partial") return <span className="inline-flex items-center gap-1 text-amber-400"><Minus className="w-4 h-4" /> Partial</span>;
  return <span className="text-foreground/90">{value}</span>;
};

const CompareAlternative = () => {
  const { slug } = useParams<{ slug: string }>();
  const data = slug ? DATA[slug] : undefined;

  useEffect(() => {
    if (!data) return;
    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.text = JSON.stringify([
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://www.scarpers.co.uk/" },
          { "@type": "ListItem", position: 2, name: `${data.competitorShort} alternative`, item: `https://www.scarpers.co.uk/compare/${data.slug}` },
        ],
      },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: data.faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ]);
    document.head.appendChild(ld);
    return () => { ld.remove(); };
  }, [data]);

  const lastUpdated = useMemo(
    () => new Date(LAST_UPDATED_ISO).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    [],
  );

  if (!slug || !data) return <Navigate to="/" replace />;

  return (
    <MarketingPageLayout
      title={data.metaTitle}
      description={data.metaDescription}
      canonicalPath={`/compare/${data.slug}`}
    >
      <article className="prose prose-invert max-w-none">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-2" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
          Looking for a {data.competitor} alternative? Here's an honest comparison.
        </h1>
        <p className="text-xs text-muted-foreground mb-4">
          Last updated: {lastUpdated} · By the Scarpers Team
        </p>
        <p className="text-lg text-muted-foreground leading-relaxed">
          {data.oneLiner} Scarpers is a free, AI-built running coach focused on plan personalisation from your real
          Garmin and Strava data. This page is a straight, factual comparison — including where {data.competitorShort}{" "}
          is genuinely the better choice.
        </p>

        <h2 className="text-2xl font-semibold mt-10 mb-3">{data.competitorShort} in one paragraph</h2>
        <p className="text-muted-foreground leading-relaxed">{data.competitorOneLiner}</p>

        <h2 className="text-2xl font-semibold mt-10 mb-3">Scarpers in one paragraph</h2>
        <p className="text-muted-foreground leading-relaxed">
          Scarpers reads your last eight weeks of running and 30 nights of sleep, scores you on a 0–200 Running IQ,
          calculates a daily readiness score from sleep, HRV and training load, and writes a week-by-week plan with
          target intensity, HR zone and music BPM for every session. Day-ahead briefings and post-run reviews come from
          an AI coach trained on running-specific reasoning. The 5K, 10K, half marathon and marathon plans are all
          free — no trial, no credit card.
        </p>

        <h2 className="text-2xl font-semibold mt-10 mb-3">Feature comparison: Scarpers vs {data.competitorShort}</h2>
        <div className="not-prose overflow-x-auto rounded-xl border border-border/40 bg-card/40">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left">
              <tr>
                <th className="p-3 font-medium">Feature</th>
                <th className="p-3 font-medium">Scarpers</th>
                <th className="p-3 font-medium">{data.competitorShort}</th>
              </tr>
            </thead>
            <tbody>
              {data.table.map((r) => (
                <tr key={r.feature} className="border-t border-border/30">
                  <td className="p-3 text-foreground/90">{r.feature}</td>
                  <td className="p-3"><Cell value={r.scarpers} /></td>
                  <td className="p-3"><Cell value={r.competitor} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Sourced from each product's public website and in-app behaviour at the date above. If anything is out of date,
          please <Link to="/about" className="underline">let us know</Link>.
        </p>

        <h2 className="text-2xl font-semibold mt-10 mb-3">When Scarpers is the better choice</h2>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2 mt-2">
          {data.scarpersBetter.map((b) => <li key={b}>{b}</li>)}
        </ul>

        <h2 className="text-2xl font-semibold mt-10 mb-3">When {data.competitorShort} is the better choice</h2>
        <p className="text-muted-foreground leading-relaxed">
          Building trust means being honest about where the other tool wins. If any of these matter more to you than
          price or transparency, {data.competitorShort} is the right pick:
        </p>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2 mt-2">
          {data.competitorBetter.map((b) => <li key={b}>{b}</li>)}
        </ul>

        <h2 className="text-2xl font-semibold mt-10 mb-3">Why runners switch from {data.competitorShort}</h2>
        <blockquote className="border-l-4 border-primary/60 pl-4 italic text-foreground/90 my-4">
          "I switched from {data.competitorShort} because I wanted a coach that actually used my Garmin history and
          didn't disappear the moment I stopped paying." — paraphrased from messages we get from new Scarpers users.
        </blockquote>
        <p className="text-muted-foreground leading-relaxed">{data.switchReason}</p>

        <h2 className="text-2xl font-semibold mt-10 mb-3">Pricing</h2>
        <p className="text-muted-foreground leading-relaxed">
          Scarpers is free. There is no trial that expires and no credit card requirement. {data.competitorShort}'s
          pricing is set by them and can change — check their{" "}
          <a href={data.competitorUrl} target="_blank" rel="noopener noreferrer" className="underline">website</a>{" "}
          for the current rate. As a rough rule of thumb: a year on a paid running app is usually £100–£250, which is
          the running cost Scarpers avoids by being built on lean, cloud-native infrastructure.
        </p>

        <h2 className="text-2xl font-semibold mt-10 mb-3">How to migrate from {data.competitorShort} to Scarpers</h2>
        <ol className="list-decimal pl-6 text-muted-foreground space-y-2 mt-2">
          <li>Create a free Scarpers account — email and password, no card.</li>
          <li>Connect Strava so recent activities flow in automatically.</li>
          <li>For deeper history, request your Garmin Connect export (a ZIP of FIT files) and drop it into the Upload page — Scarpers parses years of runs in one go.</li>
          <li>Finish onboarding: your goal distance, weekly mileage, experience, and any injury history.</li>
          <li>Your personalised plan and Running IQ appear immediately. Cancel your {data.competitorShort} subscription when you're happy.</li>
        </ol>

        <h2 className="text-2xl font-semibold mt-10 mb-3">FAQ</h2>
        <div className="space-y-5 mt-2">
          {data.faqs.map((f) => (
            <div key={f.q}>
              <h3 className="text-lg font-semibold text-foreground">{f.q}</h3>
              <p className="text-muted-foreground leading-relaxed mt-1">{f.a}</p>
            </div>
          ))}
        </div>

        <div className="not-prose mt-12 rounded-2xl border border-border/40 bg-gradient-to-br from-primary/20 to-fuchsia-500/10 p-6 sm:p-8 text-center">
          <h3 className="text-2xl sm:text-3xl font-bold mb-2" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
            Try Scarpers Free — No Credit Card Required
          </h3>
          <p className="text-muted-foreground mb-5 max-w-xl mx-auto">
            Personalised 5K, 10K, half marathon and marathon plans. Garmin FIT import, readiness scoring and an AI
            coach. All free, forever.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Button asChild size="lg" className="rounded-full">
              <Link to="/auth">Get started free</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-full">
              <Link to="/ai-running-coach">How the AI coach works</Link>
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-10">
          Scarpers is not affiliated with {data.competitorShort}. {data.competitorShort} is a trademark of its
          respective owner. Feature comparisons reflect publicly available information at the last-updated date above.
        </p>
      </article>
    </MarketingPageLayout>
  );
};

export default CompareAlternative;

import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import MarketingPageLayout from "@/components/MarketingPageLayout";

const LAST_UPDATED_ISO = "2026-05-12";

const TenKTrainingPlan = () => {
  useEffect(() => {
    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.text = JSON.stringify([
      {
        "@context": "https://schema.org",
        "@type": "Course",
        name: "Free Personalised 10K Training Plan",
        description: "AI-generated 8–10 week 10K training plan with threshold, intervals, race-pace work, HR zones and Garmin sync.",
        provider: { "@type": "Organization", name: "Scarpers", url: "https://www.scarpers.co.uk/" },
        url: "https://www.scarpers.co.uk/10k-training-plan",
        hasCourseInstance: {
          "@type": "CourseInstance",
          courseMode: "online",
          courseWorkload: "PT8W",
        },
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://www.scarpers.co.uk/" },
          { "@type": "ListItem", position: 2, name: "10K Training Plan", item: "https://www.scarpers.co.uk/10k-training-plan" },
        ],
      },
    ]);
    document.head.appendChild(ld);
    return () => { ld.remove(); };
  }, []);

  const lastUpdated = new Date(LAST_UPDATED_ISO).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
  <MarketingPageLayout
    title="Free Personalised 10K Training Plan | Scarpers"
    description="Get a free personalised 10K training plan from Scarpers' AI coach. Built around your fitness, injuries and HR zones, with Garmin sync."
    canonicalPath="/10k-training-plan"
  >
    <article className="prose prose-invert max-w-none">
      <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-2" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
        Free Personalised 10K Training Plan
      </h1>
      <p className="text-xs text-muted-foreground mb-4">Last updated: {lastUpdated} · Reviewed by the Scarpers team</p>
      <p className="text-lg text-muted-foreground leading-relaxed">
        The 10K is one of the toughest distances to train for — long enough to need real aerobic endurance, short
        enough that pace still matters. Scarpers generates a free personalised 10K training plan in under two minutes
        using your running data, sleep, readiness and injury history, so you arrive at the start line fit, fresh and
        ready to PB.
      </p>

      <h2 className="text-2xl font-semibold mt-10 mb-3">What your 10K plan includes</h2>
      <p className="text-muted-foreground leading-relaxed">
        Scarpers 10K plans run 8 to 10 weeks and combine three pillars: aerobic base, threshold work and race-pace
        specificity. A typical week looks like:
      </p>
      <ul className="list-disc pl-6 text-muted-foreground space-y-1 mt-2">
        <li><strong>Two easy aerobic runs</strong> to build mitochondrial density without piling on fatigue.</li>
        <li>A <strong>threshold or tempo session</strong> — cruise intervals, blocks of half-marathon pace, or progression runs.</li>
        <li>A <strong>VO2 / 10K-pace session</strong> with short reps that train top-end aerobic power.</li>
        <li>A <strong>long run</strong> with optional 10K-pace finish to rehearse race pace on tired legs.</li>
        <li>A <strong>taper</strong> in the final 7–10 days that drops volume but keeps intensity sharp.</li>
      </ul>

      <h2 className="text-2xl font-semibold mt-10 mb-3">How the plan adapts to you</h2>
      <p className="text-muted-foreground leading-relaxed">
        Scarpers analyses your last eight weeks of activities — average pace, weekly mileage, HR drift, consistency
        and any recent races — to estimate fitness. Faster runners get sharper intervals and a more aggressive
        threshold pace; runners returning from a break get a build-up phase before any hard work. The plan is
        re-evaluated continuously: every imported run feeds the day-ahead briefings and post-workout reviews, and
        sessions adjust around your readiness score.
      </p>

      <h2 className="text-2xl font-semibold mt-10 mb-3">Injury safety</h2>
      <p className="text-muted-foreground leading-relaxed">
        Onboarding asks about current and recent injuries. Scarpers caps weekly volume increases, reduces high-impact
        sessions where appropriate and swaps in cross-training when load needs to come down. If readiness drops or
        sleep tanks, the AI auto-deloads the next day rather than forcing a hard session through fatigue. That's how
        you stay healthy long enough to actually race.
      </p>

      <h2 className="text-2xl font-semibold mt-10 mb-3">HR zones for 10K training</h2>
      <p className="text-muted-foreground leading-relaxed">
        10K training lives in zone 2 (easy) and zone 4 (threshold). Scarpers uses a five-zone heart rate model so
        every easy run stays genuinely easy and every threshold session hits the right physiological stimulus. Your
        max HR comes from onboarding or your imported activities, and target zones are exported to your watch so
        you can train by feel without guessing.
      </p>

      <h2 className="text-2xl font-semibold mt-10 mb-3">Garmin sync</h2>
      <p className="text-muted-foreground leading-relaxed">
        Every session exports to Intervals.icu with structured warm-ups, work, recoveries and cool-downs already
        encoded. From there it syncs to your Garmin watch and runs as a guided workout with HR targets and lap
        prompts. Importing your latest .FIT files back into Scarpers keeps the plan up to date.
      </p>

      <h2 className="text-2xl font-semibold mt-10 mb-3">Is sub-60 a realistic 10K target?</h2>
      <p className="text-muted-foreground leading-relaxed">
        Sub-60 — averaging around 6:00/km (9:39/mile) for 10K — is the headline target for a huge slice of recreational
        runners. It's challenging but achievable for most runners with a consistent 20–30km training week. Scarpers
        looks at your recent easy pace, threshold estimate and weekly mileage to judge whether sub-60 is realistic
        for your timeline. If it is, the plan layers in race-pace blocks during long runs and threshold sessions
        that bridge from your current ability to goal pace. If you're further off, the plan builds aerobic capacity
        first so you actually hold the pace on race day rather than fading hard after 7K.
      </p>

      <h2 className="text-2xl font-semibold mt-10 mb-3">Start your 10K plan</h2>
      <p className="text-muted-foreground leading-relaxed">
        Sign up, complete the short onboarding flow, and your free personalised 10K plan is generated in under two
        minutes. Adjust it any time — Scarpers regenerates around your latest data on demand.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild size="lg" className="rounded-full">
          <Link to="/auth">Get my free 10K plan</Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="rounded-full">
          <Link to="/5k-training-plan">Looking for 5K?</Link>
        </Button>
      </div>
    </article>
  </MarketingPageLayout>
  );
};

export default TenKTrainingPlan;

import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import MarketingPageLayout from "@/components/MarketingPageLayout";

const LAST_UPDATED_ISO = "2026-05-12";

const FiveKTrainingPlan = () => {
  useEffect(() => {
    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.text = JSON.stringify([
      {
        "@context": "https://schema.org",
        "@type": "Course",
        name: "Free Personalised 5K Training Plan",
        description: "AI-generated 6–8 week 5K training plan with three to four runs per week, HR zones and Garmin sync.",
        provider: { "@type": "Organization", name: "Scarpers", url: "https://www.scarpers.co.uk/" },
        url: "https://www.scarpers.co.uk/5k-training-plan",
        hasCourseInstance: {
          "@type": "CourseInstance",
          courseMode: "online",
          courseWorkload: "PT6W",
        },
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://www.scarpers.co.uk/" },
          { "@type": "ListItem", position: 2, name: "5K Training Plan", item: "https://www.scarpers.co.uk/5k-training-plan" },
        ],
      },
    ]);
    document.head.appendChild(ld);
    return () => { ld.remove(); };
  }, []);

  const lastUpdated = new Date(LAST_UPDATED_ISO).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
  <MarketingPageLayout
    title="Free Personalised 5K Training Plan | Scarpers"
    description="Get a free personalised 5K training plan built by AI around your fitness, injury history and HR zones. Beginner-friendly, Garmin-ready, adapts week by week."
    canonicalPath="/5k-training-plan"
  >
    <article className="prose prose-invert max-w-none">
      <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-2" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
        Free Personalised 5K Training Plan
      </h1>
      <p className="text-xs text-muted-foreground mb-4">Last updated: {lastUpdated} · Reviewed by the Scarpers team</p>
      <p className="text-lg text-muted-foreground leading-relaxed">
        Scarpers builds a free, personalised 5K training plan in under two minutes. Instead of handing you a generic
        Couch-to-5K spreadsheet, the AI reads your real running data, sleep, readiness and any injury history — then
        writes a week-by-week plan that fits your life and your goal.
      </p>

      <h2 className="text-2xl font-semibold mt-10 mb-3">What your 5K plan includes</h2>
      <p className="text-muted-foreground leading-relaxed">
        Every Scarpers 5K plan is a 6 to 8 week block, structured around three or four runs per week. You get a clear
        weekly schedule with the run type, target intensity, duration and music BPM cue for cadence. A typical week
        contains:
      </p>
      <ul className="list-disc pl-6 text-muted-foreground space-y-1 mt-2">
        <li>An <strong>easy run</strong> to build aerobic base without spiking fatigue.</li>
        <li>A <strong>structured intervals session</strong> — short reps at 5K effort to build top-end speed.</li>
        <li>A <strong>tempo or progression run</strong> to lift your lactate threshold and 5K race pace.</li>
        <li>A <strong>long easy run</strong> to grow endurance even at the 5K distance.</li>
        <li><strong>Rest or cross-training</strong> days the AI schedules around your readiness.</li>
      </ul>

      <h2 className="text-2xl font-semibold mt-10 mb-3">How it adapts to your fitness</h2>
      <p className="text-muted-foreground leading-relaxed">
        Onboarding asks for your weekly mileage, recent race times and experience. If you've already connected Strava
        or imported FIT files, Scarpers analyses your last eight weeks of running — average pace, distance, heart rate
        and consistency — to estimate your current fitness. Faster runners get sharper intervals and a higher
        threshold pace; complete beginners get a gentle run-walk progression that grows safely week by week. The plan
        is never the same twice.
      </p>

      <h2 className="text-2xl font-semibold mt-10 mb-3">Injury-aware programming</h2>
      <p className="text-muted-foreground leading-relaxed">
        Most plans ignore injuries. Scarpers asks about current niggles and recent injury history during onboarding,
        and the AI uses that to shape the plan. Coming back from shin splints? The plan limits high-impact intervals
        and lengthens easy mileage. Knee or Achilles concerns? Volume ramps more conservatively and the AI swaps
        some sessions for lower-impact cross-training. Each post-run review also flags if effort or pace looks off
        relative to your recent history.
      </p>

      <h2 className="text-2xl font-semibold mt-10 mb-3">HR zone training</h2>
      <p className="text-muted-foreground leading-relaxed">
        Pace alone lies on hilly days, hot days and tired days. Scarpers uses a five-zone heart rate model — easy,
        steady, tempo, threshold and VO2 — and prescribes each run by intensity rather than only by pace. Your
        zones come from your max HR (entered during onboarding or estimated from your data), and every session
        exports with the right target zone so your watch beeps when you drift too hard or too easy.
      </p>

      <h2 className="text-2xl font-semibold mt-10 mb-3">Garmin sync &amp; watch-ready workouts</h2>
      <p className="text-muted-foreground leading-relaxed">
        Scarpers exports every session to Intervals.icu using native interval syntax with warm-ups, work intervals,
        recoveries and cool-downs already structured. From there it syncs to your Garmin watch and runs as a guided
        workout — no manually building intervals on a tiny screen. You can also import .FIT files from any Garmin
        watch so Scarpers always has the latest data to adapt the plan.
      </p>

      <h2 className="text-2xl font-semibold mt-10 mb-3">Is a sub-30 5K achievable?</h2>
      <p className="text-muted-foreground leading-relaxed">
        For many runners, sub-30 is the breakthrough goal — it means averaging around 6:00/km (or 9:39/mile) for the
        full 5K. It's absolutely achievable, but it isn't automatic. Scarpers checks your recent easy pace, your HR
        drift and your weekly mileage to see whether sub-30 is realistic in the time frame you've chosen, then builds
        the plan to get you there: enough easy aerobic volume to handle the pace, intervals fast enough to lift your
        top end, and at least one weekly run at goal 5K pace so the effort feels familiar on race day. If you're
        further out, the plan ramps conservatively first so you arrive at race week healthy rather than half-fit.
      </p>

      <h2 className="text-2xl font-semibold mt-10 mb-3">Ready to start?</h2>
      <p className="text-muted-foreground leading-relaxed">
        Sign up, answer a few onboarding questions, and your free personalised 5K training plan is ready in under
        two minutes. No credit card, no spreadsheets, no generic templates.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild size="lg" className="rounded-full">
          <Link to="/auth">Get my free 5K plan</Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="rounded-full">
          <Link to="/ai-running-coach">How the AI works</Link>
        </Button>
      </div>
    </article>
  </MarketingPageLayout>
  );
};

export default FiveKTrainingPlan;

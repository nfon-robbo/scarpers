import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import MarketingPageLayout from "@/components/MarketingPageLayout";

const AIRunningCoach = () => (
  <MarketingPageLayout
    title="AI Running Coach — How Scarpers Builds Your Personalised Plan"
    description="Scarpers is an AI running coach that builds personalised training plans from your running data, sleep, readiness and goals. See how it works and how it differs from a human coach."
    canonicalPath="/ai-running-coach"
  >
    <article className="prose prose-invert max-w-none">
      <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
        AI Running Coach
      </h1>
      <p className="text-lg text-muted-foreground leading-relaxed">
        Scarpers is an AI running coach that writes a personalised training plan around your fitness, your sleep,
        your injuries and your race goal — then adapts it day by day based on how training is actually going.
        Below is how it works and what makes it different from a generic plan or a human coach.
      </p>

      <h2 className="text-2xl font-semibold mt-10 mb-3">How the AI builds your plan</h2>
      <p className="text-muted-foreground leading-relaxed">
        Onboarding takes about two minutes. You pick a target distance (5K, 10K, half, marathon or ultra), enter
        your experience level, weekly mileage and any current or recent injuries. If you've connected Strava,
        imported FIT files or linked Google Fit, Scarpers pulls in the last eight weeks of activities and 30 nights
        of sleep. The AI then writes a week-by-week plan with run types, target intensities, paces, heart rate zones
        and music BPM cues for cadence.
      </p>
      <p className="text-muted-foreground leading-relaxed mt-3">
        Plans aren't templates with your name dropped in. Every session is generated for you — the intervals
        change, the long run distance changes, the rest days change. Two runners with the same goal but different
        injury history or weekly mileage will get genuinely different plans.
      </p>

      <h2 className="text-2xl font-semibold mt-10 mb-3">What data Scarpers uses</h2>
      <ul className="list-disc pl-6 text-muted-foreground space-y-1 mt-2">
        <li><strong>Activity history</strong> — pace, distance, duration, HR drift and consistency from FIT files or Strava.</li>
        <li><strong>Heart rate</strong> — five-zone model from your max HR, with HR drift signalling fatigue.</li>
        <li><strong>Sleep</strong> — 365-day calendar with stages from Google Fit or your watch.</li>
        <li><strong>Readiness</strong> — a composite of sleep, resting HR, HRV and recent training load.</li>
        <li><strong>Running IQ</strong> — a 0–200 score across durability, consistency, progression, recovery and pace.</li>
        <li><strong>Onboarding answers</strong> — experience, weekly mileage, injuries and goal race.</li>
      </ul>

      <h2 className="text-2xl font-semibold mt-10 mb-3">Day-ahead briefings &amp; post-workout reviews</h2>
      <p className="text-muted-foreground leading-relaxed">
        Each morning Scarpers writes a short day-ahead briefing for your scheduled session: target intensity, key
        focus points, target HR zone and cadence cue. If readiness drops, the AI surgically adjusts the session —
        swapping intervals for easy running, or shortening the long run — rather than letting you crash through a
        hard day under-recovered.
      </p>
      <p className="text-muted-foreground leading-relaxed mt-3">
        After every workout you get an AI review: what went well, what to build on, and how the run compared to the
        plan's target. Reviews stay focused — five bullets, no fluff, and never longer than 150 words.
      </p>

      <h2 className="text-2xl font-semibold mt-10 mb-3">How it differs from a human coach</h2>
      <p className="text-muted-foreground leading-relaxed">
        A great human coach is hard to beat for the relationship, the nuance and the accountability. They're also
        £80–£250 a month, mostly reachable only by email, and they can only hold so much of your data in their head.
        Scarpers complements that role rather than replacing the entire coaching relationship:
      </p>
      <ul className="list-disc pl-6 text-muted-foreground space-y-1 mt-2">
        <li><strong>Free</strong> — no monthly subscription.</li>
        <li><strong>24/7</strong> — day-ahead briefings and post-run reviews land instantly.</li>
        <li><strong>Data-driven</strong> — reads your full history, not just what you remembered to mention.</li>
        <li><strong>Adaptive</strong> — every imported run and sleep night feeds the next session.</li>
        <li><strong>Consistent</strong> — applies the same logic to every athlete: easy days easy, hard days hard.</li>
      </ul>
      <p className="text-muted-foreground leading-relaxed mt-3">
        For most runners — from complete beginners to sub-3 marathoners — Scarpers covers the day-to-day plan
        writing and analysis a coach would do, and frees you up to actually run.
      </p>

      <h2 className="text-2xl font-semibold mt-10 mb-3">Is AI coaching safe?</h2>
      <p className="text-muted-foreground leading-relaxed">
        Used responsibly, yes. Scarpers respects the injury history you enter during onboarding, caps how fast weekly
        volume can increase, and auto-deloads when readiness drops or sleep tanks. The AI is conservative by design:
        easy days stay easy, hard days are earned. That said, AI coaching is a complement to — not a replacement for —
        professional medical or physiotherapy advice. If you're returning from surgery, managing a chronic injury, or
        new to exercise with underlying health conditions, please consult a qualified professional before starting any
        training plan. Stop and seek advice if a session causes sharp pain, swelling or symptoms that don't settle.
      </p>

      <h2 className="text-2xl font-semibold mt-10 mb-3">Try it free</h2>
      <p className="text-muted-foreground leading-relaxed">
        Sign up and your first personalised plan is ready in under two minutes.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild size="lg" className="rounded-full">
          <Link to="/auth">Start free</Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="rounded-full">
          <Link to="/5k-training-plan">5K plan</Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="rounded-full">
          <Link to="/10k-training-plan">10K plan</Link>
        </Button>
      </div>
    </article>
  </MarketingPageLayout>
);

export default AIRunningCoach;

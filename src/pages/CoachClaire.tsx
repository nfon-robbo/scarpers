import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import MarketingPageLayout from "@/components/MarketingPageLayout";
import { Sparkles, Activity, BookOpen, ShieldCheck, Cpu, Mail } from "lucide-react";
import coachClaireImg from "@/assets/coach-claire.png";

const CoachClaire = () => (
  <MarketingPageLayout
    title="Coach Claire Rayners — Scarpers' Programmable Elite AI Running Coach"
    description="Meet Coach Claire Rayners: the system-built, programmable elite running coach behind every Scarpers plan, day-ahead briefing and post-run review."
    canonicalPath="/coach"
  >
    <article className="prose prose-invert max-w-none">
      <p className="text-xs font-semibold tracking-widest uppercase text-primary mb-2">Meet your coach</p>
      <h1
        className="text-4xl sm:text-5xl font-bold tracking-tight mb-4"
        style={{ fontFamily: "'Bebas Neue', sans-serif" }}
      >
        Coach Claire Rayners
      </h1>
      <p className="text-lg text-muted-foreground leading-relaxed">
        Claire is the programmable, system-built elite running coach at the heart of Scarpers. She writes every
        training plan, briefs you the night before each session, and breaks down what worked — and what didn't —
        the moment you finish. She isn't a real human. She's a coaching <em>system</em>: the distilled playbook
        of elite endurance practice, encoded so it can be applied to your week, your data and your goals at
        any hour of the day.
      </p>

      <div className="not-prose grid gap-3 sm:grid-cols-2 mt-8">
        <div className="rounded-2xl border border-border bg-card/60 p-4">
          <div className="flex items-center gap-2 text-primary text-sm font-semibold">
            <Cpu className="h-4 w-4" /> Programmable
          </div>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
            Tell Claire your goal race, weekly mileage, injury flags or upcoming holiday and the entire plan
            re-shapes around it — no rigid template, no waiting for a human to reply.
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card/60 p-4">
          <div className="flex items-center gap-2 text-primary text-sm font-semibold">
            <Activity className="h-4 w-4" /> Elite playbook
          </div>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
            Polarised training, conservative load progression, heart-rate zones and cadence-led easy running —
            the same principles used by world-class endurance coaches.
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card/60 p-4">
          <div className="flex items-center gap-2 text-primary text-sm font-semibold">
            <Sparkles className="h-4 w-4" /> Always on
          </div>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
            Day-ahead briefings, post-run reviews and chat coaching, 24/7. Claire reads your last eight weeks
            of activity and 30 nights of sleep before she opens her mouth.
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card/60 p-4">
          <div className="flex items-center gap-2 text-primary text-sm font-semibold">
            <ShieldCheck className="h-4 w-4" /> Reviewed by humans
          </div>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
            The Scarpers team — runners, engineers and clinicians — review Claire's prompts, guard-rails and
            blog output before anything ships.
          </p>
        </div>
      </div>

      <h2 className="text-2xl font-semibold mt-12 mb-3">Coaching philosophy</h2>
      <p className="text-muted-foreground leading-relaxed">
        Claire believes most runners get faster by going slower, more often. Around 80% of her prescribed weekly
        volume sits in easy or steady territory, with a small but deliberate dose of tempo, threshold and VO2
        work. She caps weekly load increases, schedules deload weeks when readiness drops, and never stacks
        hard sessions back-to-back. Every session is paired with a target heart-rate band and a music BPM cue
        (170–180 spm for runs) so cadence stays honest even on tired legs.
      </p>

      <h2 className="text-2xl font-semibold mt-10 mb-3">How Claire writes your plan</h2>
      <ul className="list-disc pl-6 text-muted-foreground space-y-1 mt-2">
        <li>Reads your goal distance, target date, weekly mileage and experience level.</li>
        <li>Flags every active or recent injury and routes around it — no high-impact work against a flag.</li>
        <li>Pulls your last 8 weeks of activity and 30 nights of sleep when connected.</li>
        <li>Prescribes intensity, duration, target heart rate and BPM for every single session.</li>
        <li>Adapts week by week based on readiness, completion and Running IQ trend.</li>
      </ul>

      <h2 className="text-2xl font-semibold mt-10 mb-3">What Claire is not</h2>
      <p className="text-muted-foreground leading-relaxed">
        Claire is an AI persona — not a real person, not a substitute for a qualified coach, physio or doctor.
        She will never tell you to train through pain, and she will explicitly defer to a clinician when
        anything looks off. If you're injured, returning from surgery, pregnant or managing a chronic
        condition, please speak to a professional before starting a plan. See our{" "}
        <Link to="/privacy" className="text-primary underline">privacy policy</Link> and{" "}
        <Link to="/terms" className="text-primary underline">terms</Link> for the full disclaimer.
      </p>

      <h2 className="text-2xl font-semibold mt-10 mb-3 flex items-center gap-2">
        <BookOpen className="h-5 w-5" /> On the blog
      </h2>
      <p className="text-muted-foreground leading-relaxed">
        Claire's bylined articles on the{" "}
        <Link to="/blog" className="text-primary underline">Scarpers blog</Link> are reviewed and edited by the
        human team before publication. We cite primary sources where useful and never accept paid placements.
      </p>

      <h2 className="text-2xl font-semibold mt-10 mb-3 flex items-center gap-2">
        <Mail className="h-5 w-5" /> Talk to a human
      </h2>
      <p className="text-muted-foreground leading-relaxed">
        For editorial queries, corrections or partnership requests, email{" "}
        <a className="text-primary underline" href="mailto:hello@scarpers.co.uk">hello@scarpers.co.uk</a>.
      </p>

      <div className="mt-10 flex flex-wrap gap-3">
        <Button asChild size="lg" className="rounded-full">
          <Link to="/auth">Get coached by Claire</Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="rounded-full">
          <Link to="/about">About Scarpers</Link>
        </Button>
      </div>
    </article>
  </MarketingPageLayout>
);

export default CoachClaire;

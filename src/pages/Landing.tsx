import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Activity,
  Brain,
  Calendar,
  ChevronDown,
  Heart,
  LineChart,
  Moon,
  Sparkles,
  Target,
  Upload,
  Watch,
  Zap,
} from "lucide-react";
import scarpersIcon from "@/assets/scarpers-icon.png";
import scarpersWordmark from "@/assets/scarpers-wordmark.png";

const FAQS = [
  {
    q: "How does the AI running coach build my training plan?",
    a: "Scarpers analyses your recent runs, resting heart rate, sleep and stated goal (5K, 10K, half marathon, marathon or ultra) and writes a week-by-week plan using OpenAI. It includes intensity targets, music BPM (170–180 spm), recovery weeks and a clear taper.",
  },
  {
    q: "Is Scarpers free?",
    a: "Yes — Scarpers is free to use. Sign up, import your runs and generate your first AI training plan in under two minutes.",
  },
  {
    q: "Which devices and apps does it work with?",
    a: "Anything that exports a .FIT file (Garmin, Coros, Polar, Suunto, Wahoo, Apple Watch via export apps, Android Health Connect) plus direct Strava OAuth import. Apple Health sleep and readiness data sync automatically.",
  },
  {
    q: "Can I follow a marathon plan if I'm a beginner?",
    a: "Yes. During onboarding you tell Scarpers your experience level, weekly mileage and any injuries. The AI scales the plan to your current fitness and progresses load safely (ACWR-aware).",
  },
  {
    q: "Does it replace a human coach?",
    a: "It replaces the day-to-day plan-writing and analysis a coach does, at a fraction of the cost. You get personalised workouts, post-run reviews and a daily readiness score 24/7.",
  },
  {
    q: "Can I export my plan to Garmin or Intervals.icu?",
    a: "Yes — one-click export to Intervals.icu using native interval syntax with target heart rate zones. Your watch then picks up the structured workouts.",
  },
];

const PLANS = [
  { distance: "5K", weeks: "6–8 weeks", who: "First-timers & PB chasers" },
  { distance: "10K", weeks: "8–10 weeks", who: "Building speed and endurance" },
  { distance: "Half Marathon", weeks: "12 weeks", who: "Most popular distance" },
  { distance: "Marathon", weeks: "16–20 weeks", who: "London, Berlin, NYC, Boston" },
  { distance: "Ultra", weeks: "20–24 weeks", who: "50K, 50mi, 100K trail" },
];

const FEATURES = [
  {
    icon: Brain,
    title: "AI training plans",
    body: "Personalised week-by-week plans for any distance, written by AI from your real running data and goals.",
  },
  {
    icon: Upload,
    title: "FIT file & Strava import",
    body: "Drop a .FIT file or connect Strava. Garmin, Coros, Polar, Suunto, Wahoo, Apple Watch — all welcome.",
  },
  {
    icon: Heart,
    title: "Daily readiness score",
    body: "Sleep, resting HR, HRV and training load combined into one honest score that tells you to push or back off.",
  },
  {
    icon: LineChart,
    title: "Running IQ",
    body: "A 0–200 score across 5 pillars — durability, consistency, progression, recovery and pace — that tracks how you're really developing.",
  },
  {
    icon: Moon,
    title: "Sleep tracking",
    body: "365-day sleep calendar with stages, merged from Apple Health, Google Fit and your watch.",
  },
  {
    icon: Sparkles,
    title: "Day-ahead AI coach",
    body: "Wake up to a smart preview of today's run with pacing, music BPM and a focus cue — adapted to last night's sleep.",
  },
  {
    icon: Activity,
    title: "Post-run reviews",
    body: "Every run gets an AI debrief: what went well, what to build on, and how it fits the bigger picture.",
  },
  {
    icon: Target,
    title: "Race-ready taper",
    body: "Plans peak you on the right day with a properly engineered taper — no guesswork, no overtraining.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Tell us your goal",
    body: "Pick your race distance and date, share your experience and any injuries.",
  },
  {
    n: "02",
    title: "Import your runs",
    body: "Upload a .FIT file or connect Strava. We handle the rest — including duplicate detection.",
  },
  {
    n: "03",
    title: "Train smarter, daily",
    body: "Get an AI plan, daily readiness, post-run reviews and a clear path to race day.",
  },
];

const Landing = () => {
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  useEffect(() => {
    document.title = "Scarpers — AI Running Coach & Personalised Training Plans";

    // FAQ JSON-LD for rich results
    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQS.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
    document.head.appendChild(ld);

    const org = document.createElement("script");
    org.type = "application/ld+json";
    org.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Scarpers",
      applicationCategory: "HealthApplication",
      operatingSystem: "Web, iOS, Android",
      description:
        "AI running coach that builds personalised training plans for 5K, 10K, half marathon, marathon and ultra distances.",
      offers: { "@type": "Offer", price: "0", priceCurrency: "GBP" },
      url: "https://www.scarpers.co.uk/",
    });
    document.head.appendChild(org);

    return () => {
      ld.remove();
      org.remove();
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Background decoration */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute top-1/3 -right-40 w-[600px] h-[600px] rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 w-[500px] h-[500px] rounded-full bg-primary/10 blur-3xl" />
      </div>

      {/* Nav */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/70 border-b border-border/40">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src={scarpersIcon} alt="" className="h-9 w-9 object-contain" />
            <img src={scarpersWordmark} alt="Scarpers" className="h-5 w-auto object-contain" />
          </Link>
          <nav className="hidden md:flex items-center gap-7 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition">Features</a>
            <a href="#plans" className="hover:text-foreground transition">Plans</a>
            <a href="#how" className="hover:text-foreground transition">How it works</a>
            <a href="#faq" className="hover:text-foreground transition">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link to="/auth">Sign in</Link>
            </Button>
            <Button asChild size="sm" className="bg-gradient-to-r from-primary to-accent text-primary-foreground border-0 hover:opacity-90">
              <Link to="/auth">Get started free</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative max-w-6xl mx-auto px-5 pt-16 sm:pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-border/60 bg-card/50 backdrop-blur text-xs font-medium text-muted-foreground mb-6">
          <Zap className="w-3.5 h-3.5 text-primary" />
          AI running coach · Free during beta
        </div>
        <h1 className="text-4xl sm:text-6xl md:text-7xl font-bold tracking-tight leading-[1.05] max-w-4xl mx-auto" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          Your{" "}
          <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
            AI running coach
          </span>{" "}
          for every distance
        </h1>
        <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          Personalised training plans for 5K, 10K, half marathon, marathon and ultra — written from your real running data, sleep and readiness. Built for runners who want to train smarter, not just harder.
        </p>
        <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button asChild size="lg" className="h-12 px-7 bg-gradient-to-r from-primary to-accent text-primary-foreground border-0 hover:opacity-90 text-base">
            <Link to="/auth">Build my free plan</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-12 px-7 text-base">
            <a href="#how">See how it works</a>
          </Button>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          No credit card · Imports Garmin, Strava, Apple Watch, Coros, Polar
        </p>

        {/* Hero card mockup */}
        <div className="mt-16 relative max-w-4xl mx-auto">
          <div className="absolute -inset-4 bg-gradient-to-r from-primary/30 to-accent/30 blur-3xl rounded-[2rem]" />
          <div className="relative rounded-2xl border border-border/60 bg-card/80 backdrop-blur-xl shadow-2xl p-6 sm:p-8 text-left">
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="rounded-xl border border-border/40 bg-background/60 p-4">
                <p className="text-xs text-muted-foreground">Readiness</p>
                <p className="text-3xl font-bold mt-1 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">87</p>
                <p className="text-xs text-muted-foreground mt-2">Push for tempo today</p>
              </div>
              <div className="rounded-xl border border-border/40 bg-background/60 p-4">
                <p className="text-xs text-muted-foreground">Today's run</p>
                <p className="text-base font-semibold mt-1">6 × 1km @ threshold</p>
                <p className="text-xs text-muted-foreground mt-2">175 spm · easy ks between</p>
              </div>
              <div className="rounded-xl border border-border/40 bg-background/60 p-4">
                <p className="text-xs text-muted-foreground">Running IQ</p>
                <p className="text-3xl font-bold mt-1">142<span className="text-sm text-muted-foreground">/200</span></p>
                <p className="text-xs text-muted-foreground mt-2">↑ 8 this month</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust bar */}
      <section className="border-y border-border/40 bg-card/30 backdrop-blur">
        <div className="max-w-6xl mx-auto px-5 py-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-xs sm:text-sm text-muted-foreground">
          <span className="flex items-center gap-2"><Watch className="w-4 h-4" /> Garmin</span>
          <span>Strava</span>
          <span>Apple Watch</span>
          <span>Coros</span>
          <span>Polar</span>
          <span>Suunto</span>
          <span>Wahoo</span>
          <span>Intervals.icu</span>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="max-w-6xl mx-auto px-5 py-24">
        <div className="max-w-2xl mb-14">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider">Features</p>
          <h2 className="mt-2 text-3xl sm:text-5xl font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Everything you need to train smarter
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            One app. Your plan, your runs, your sleep, your readiness — all talking to each other.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((f) => (
            <article key={f.title} className="group rounded-2xl border border-border/50 bg-card/60 backdrop-blur p-5 hover:border-primary/40 hover:bg-card/80 transition-all">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 border border-border/40 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <f.icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-base font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Plans */}
      <section id="plans" className="max-w-6xl mx-auto px-5 py-24">
        <div className="max-w-2xl mb-14">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider">Training plans</p>
          <h2 className="mt-2 text-3xl sm:text-5xl font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            From your first 5K to your first 100K
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Pick a distance, set a date, get a personalised AI training plan with a real taper.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {PLANS.map((p) => (
            <Link
              to="/auth"
              key={p.distance}
              className="group rounded-2xl border border-border/50 bg-gradient-to-br from-card/80 to-card/40 backdrop-blur p-5 hover:border-primary/50 transition-all"
            >
              <p className="text-xs text-muted-foreground">{p.weeks}</p>
              <h3 className="mt-1 text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                {p.distance}
              </h3>
              <p className="mt-3 text-sm text-muted-foreground">{p.who}</p>
              <p className="mt-4 text-xs text-primary opacity-0 group-hover:opacity-100 transition">Build plan →</p>
            </Link>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="max-w-6xl mx-auto px-5 py-24">
        <div className="max-w-2xl mb-14">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider">How it works</p>
          <h2 className="mt-2 text-3xl sm:text-5xl font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            From sign-up to race day in three steps
          </h2>
        </div>
        <ol className="grid md:grid-cols-3 gap-5">
          {STEPS.map((s) => (
            <li key={s.n} className="relative rounded-2xl border border-border/50 bg-card/60 backdrop-blur p-6">
              <div className="text-5xl font-bold bg-gradient-to-br from-primary to-accent bg-clip-text text-transparent" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                {s.n}
              </div>
              <h3 className="mt-3 text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Why Scarpers */}
      <section className="max-w-6xl mx-auto px-5 py-24">
        <div className="rounded-3xl border border-border/50 bg-gradient-to-br from-primary/10 via-card/60 to-accent/10 backdrop-blur p-8 sm:p-14">
          <div className="grid lg:grid-cols-2 gap-10 items-center">
            <div>
              <p className="text-sm font-semibold text-primary uppercase tracking-wider">Why Scarpers</p>
              <h2 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                A coach that actually looks at your data
              </h2>
              <p className="mt-4 text-muted-foreground leading-relaxed">
                Generic plans give every runner the same Tuesday tempo. Scarpers reads your last 8 weeks of running, the last 30 nights of sleep, your resting HR trend and your goal — then writes a plan only you would get.
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  "Adaptive load — never red-zones into injury",
                  "Honest readiness — pulls back when you need it",
                  "Music BPM cues — 170–180 spm to lock in cadence",
                  "Real taper — peaks you on race day, not before",
                ].map((b) => (
                  <li key={b} className="flex items-start gap-3 text-sm">
                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-gradient-to-r from-primary to-accent shrink-0" />
                    <span className="text-foreground/90">{b}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { v: "5+", l: "Race distances" },
                { v: "365", l: "Day sleep history" },
                { v: "200", l: "Running IQ scale" },
                { v: "<2 min", l: "Setup to first plan" },
              ].map((s) => (
                <div key={s.l} className="rounded-2xl border border-border/40 bg-background/60 p-5 text-center">
                  <div className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                    {s.v}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{s.l}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="max-w-3xl mx-auto px-5 py-24">
        <div className="text-center mb-12">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider">FAQ</p>
          <h2 className="mt-2 text-3xl sm:text-5xl font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Questions, answered
          </h2>
        </div>
        <div className="space-y-3">
          {FAQS.map((f, i) => {
            const open = openFaq === i;
            return (
              <div key={f.q} className="rounded-2xl border border-border/50 bg-card/60 backdrop-blur overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenFaq(open ? null : i)}
                  className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-card/80 transition"
                  aria-expanded={open}
                >
                  <span className="text-sm sm:text-base font-semibold">{f.q}</span>
                  <ChevronDown className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
                {open && (
                  <div className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed">{f.a}</div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-5xl mx-auto px-5 py-24">
        <div className="relative rounded-3xl overflow-hidden border border-border/50 bg-gradient-to-br from-primary/20 via-card/80 to-accent/20 backdrop-blur p-10 sm:p-16 text-center">
          <div className="absolute inset-0 -z-10 opacity-30" style={{
            backgroundImage: "radial-gradient(circle at 30% 20%, hsl(var(--primary)) 0%, transparent 50%), radial-gradient(circle at 80% 80%, hsl(var(--accent)) 0%, transparent 50%)",
          }} />
          <Calendar className="w-10 h-10 mx-auto text-primary" />
          <h2 className="mt-4 text-3xl sm:text-5xl font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Your next race starts now
          </h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto">
            Build a personalised AI running plan in under two minutes. Free, forever.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button asChild size="lg" className="h-12 px-8 bg-gradient-to-r from-primary to-accent text-primary-foreground border-0 hover:opacity-90 text-base">
              <Link to="/auth">Build my free plan</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 px-8 text-base">
              <Link to="/auth">Sign in</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 bg-card/30 backdrop-blur">
        <div className="max-w-6xl mx-auto px-5 py-10 grid sm:grid-cols-3 gap-6 text-sm">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <img src={scarpersIcon} alt="" className="h-7 w-7 object-contain" />
              <img src={scarpersWordmark} alt="Scarpers" className="h-4 w-auto object-contain" />
            </div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              The AI running coach that reads your data and writes the plan only you should be running.
            </p>
          </div>
          <div>
            <p className="font-semibold mb-3">Product</p>
            <ul className="space-y-2 text-muted-foreground">
              <li><a href="#features" className="hover:text-foreground">Features</a></li>
              <li><a href="#plans" className="hover:text-foreground">Training plans</a></li>
              <li><a href="#how" className="hover:text-foreground">How it works</a></li>
              <li><a href="#faq" className="hover:text-foreground">FAQ</a></li>
            </ul>
          </div>
          <div>
            <p className="font-semibold mb-3">Account</p>
            <ul className="space-y-2 text-muted-foreground">
              <li><Link to="/auth" className="hover:text-foreground">Sign in</Link></li>
              <li><Link to="/auth" className="hover:text-foreground">Create account</Link></li>
              <li><Link to="/privacy" className="hover:text-foreground">Privacy</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border/40 py-5 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Scarpers · scarpers.co.uk
        </div>
      </footer>
    </div>
  );
};

export default Landing;

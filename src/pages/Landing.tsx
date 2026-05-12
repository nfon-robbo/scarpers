import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Activity,
  ArrowRight,
  Brain,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Heart,
  LineChart,
  Link2,
  Moon,
  Quote,
  Sparkles,
  Star,
  Target,
  TrendingUp,
  Upload,
  Watch,
  X,
  Zap,
} from "lucide-react";
import scarpersIcon from "@/assets/scarpers-icon.png";
import scarpersWordmark from "@/assets/scarpers-wordmark.png";
import BlogPreview from "@/components/BlogPreview";

import heroRunnerVideo from "@/assets/hero-runner.mp4.asset.json";
import heroFeetVideo from "@/assets/hero-feet-10s.mp4.asset.json";
import heroMarathonVideo from "@/assets/hero-marathon-10s.mp4.asset.json";

import watchFenix8 from "@/assets/watch-frame.png";
import watchScreen1 from "@/assets/watch-screens/screen1.png";
import watchScreen2 from "@/assets/watch-screens/screen2.png";
import watchScreen3 from "@/assets/watch-screens/screen3.png";
import watchScreen4 from "@/assets/watch-screens/screen4.png";
import watchScreen5 from "@/assets/watch-screens/screen5.png";
import watchScreen6 from "@/assets/watch-screens/screen6.png";
import watchScreen7 from "@/assets/watch-screens/screen7.png";
import watchScreen8 from "@/assets/watch-screens/screen8.png";

const HERO_VIDEOS = [heroRunnerVideo.url, heroFeetVideo.url, heroMarathonVideo.url];

const WATCH_SCREENS = [
  watchScreen2, watchScreen1, watchScreen4, watchScreen5, watchScreen3, watchScreen8, watchScreen7, watchScreen6,
];

const FENIX8_SCREEN = { top: "22.2%", left: "18.1%", width: "63.9%", height: "42.6%" };

function WatchMockup({
  frame,
  frameAlt,
  screenIndex,
  screenStyle,
}: {
  frame: string;
  frameAlt: string;
  screenIndex: number;
  screenStyle: React.CSSProperties;
}) {
  return (
    <div className="flex w-full flex-col items-center">
      <div className="relative w-[min(40vw,260px)]" style={{ aspectRatio: "1024 / 1536" }}>
        <img
          src={frame}
          alt={frameAlt}
          width={1024}
          height={1536}
          loading="lazy"
          className="absolute inset-0 w-full h-full object-contain drop-shadow-[0_25px_45px_rgba(0,0,0,0.5)]"
        />
        <div className="absolute overflow-hidden rounded-full bg-black" style={screenStyle}>
          {WATCH_SCREENS.map((src, i) => (
            <img
              key={i}
              src={src}
              alt=""
              aria-hidden={i !== screenIndex}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${
                i === screenIndex ? "opacity-100" : "opacity-0"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const FAQS = [
  {
    q: "Does Scarpers work with Garmin watches?",
    a: "Yes. Import .FIT files from any Garmin watch, and export your structured Scarpers workouts to Intervals.icu so they sync straight to your Garmin — warm-ups, intervals, recoveries and target heart rate zones, step-by-step on your wrist.",
  },
  {
    q: "How does Strava integration work?",
    a: "Connect Strava once with a single OAuth click. Scarpers pulls your historical runs and keeps syncing new activities automatically — no manual exports, no duplicates. Heart rate, pace, GPS and elevation all come through.",
  },
  {
    q: "What makes a Scarpers plan adaptive?",
    a: "Plans react to reality. If you miss a run, sleep badly, smash a session or pick up a niggle, Scarpers reshuffles upcoming workouts — reducing intensity, shifting long runs or adding recovery so you never break the chain or break yourself.",
  },
  {
    q: "Can Scarpers build a personalised marathon training plan?",
    a: "Yes. Marathon blocks run 16–20 weeks with a proper aerobic base, race-pace long runs, threshold work and a real taper. The plan adapts each week to your training load, readiness and life schedule.",
  },
  {
    q: "Is Scarpers suitable for beginner runners?",
    a: "Absolutely. New runners get a gentle run-walk progression that scales week by week. Easy paces stay easy, intensity is introduced slowly, and the plan respects how your body actually responds.",
  },
  {
    q: "What happens if I miss runs?",
    a: "Nothing breaks. Scarpers detects missed sessions and rebuilds the week — protecting your key workouts, dropping non-essential filler, and keeping your race-day fitness on track.",
  },
  {
    q: "Does Scarpers support ultra marathon training?",
    a: "Yes — 50K, 50 mile and 100K trail plans, 20–24 weeks long. Back-to-back long runs, time-on-feet sessions, vert work where supported, and recovery-aware load progression.",
  },
  {
    q: "How is Scarpers different from a static training plan?",
    a: "Static PDFs assume every Tuesday looks the same. Scarpers reads your sleep, resting HR, recent runs and readiness, then writes the plan only you should be running this week.",
  },
];

const STEPS = [
  {
    icon: Link2,
    n: "01",
    title: "Connect Your Data",
    body: "Link Garmin via FIT files or Strava in one tap. Scarpers reads your last 8 weeks of runs, sleep and heart rate.",
  },
  {
    icon: Brain,
    n: "02",
    title: "Get an Adaptive Plan",
    body: "Your plan is written from your real fitness, recovery and goal race — not a generic template.",
  },
  {
    icon: TrendingUp,
    n: "03",
    title: "Improve with Every Run",
    body: "Post-run reviews, daily readiness and dynamic adjustments keep you progressing without overtraining.",
  },
];

const FEATURES = [
  { icon: Brain, title: "Adaptive Training Plans", body: "Plans that reshape themselves every week from your runs, recovery and life schedule." },
  { icon: Watch, title: "Garmin Sync", body: "Structured workouts on your wrist via Intervals.icu — intervals, recoveries and HR targets included." },
  { icon: Activity, title: "Strava Integration", body: "One-click OAuth. Historical runs in, new activities synced automatically." },
  { icon: Heart, title: "Recovery-Aware Training", body: "Readiness from sleep, resting HR and load decides push or back off — honestly." },
  { icon: Target, title: "5K to Ultra", body: "Full distance support: 5K, 10K, half marathon, marathon and 50K–100K ultra." },
  { icon: Sparkles, title: "Dynamic Adjustments", body: "Miss a run, sleep poorly or smash a session — the plan rebuilds intelligently." },
];

const TESTIMONIALS = [
  {
    name: "James, 38",
    goal: "London Marathon · 3:24",
    body: "First plan that actually moved my long runs when I was wrecked. Hit my PB by nine minutes.",
  },
  {
    name: "Priya, 29",
    goal: "First half marathon · 1:58",
    body: "I came back from a calf injury and Scarpers built the volume back up properly. No flare-ups.",
  },
  {
    name: "Tom, 45",
    goal: "Manchester 10K · 41:12",
    body: "Felt like a real coach — not a static PDF. The watch sync is the killer feature.",
  },
];

const STATS = [
  { value: "8,400+", label: "Runs analysed" },
  { value: "5K–100K", label: "Race distances" },
  { value: "16–20 wk", label: "Marathon blocks" },
  { value: "Garmin + Strava", label: "Native integrations" },
];

const COMPARISON = [
  { feature: "Adapts to missed runs", scarpers: true, static: false, generic: false },
  { feature: "Reads sleep & resting HR", scarpers: true, static: false, generic: false },
  { feature: "Garmin structured workouts", scarpers: true, static: false, generic: "Limited" },
  { feature: "Strava auto-sync", scarpers: true, static: false, generic: true },
  { feature: "Injury-aware load scaling", scarpers: true, static: false, generic: false },
  { feature: "Daily readiness score", scarpers: true, static: false, generic: false },
  { feature: "Post-run AI debrief", scarpers: true, static: false, generic: false },
  { feature: "5K to ultra coverage", scarpers: true, static: "Some", generic: "Some" },
];

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs sm:text-sm font-semibold tracking-[0.25em] uppercase text-primary">{children}</p>
);

const H2 = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <h2
    className={`mt-3 text-3xl sm:text-5xl font-bold tracking-tight leading-[1.05] ${className}`}
    style={{ fontFamily: "'Bebas Neue', sans-serif" }}
  >
    {children}
  </h2>
);

const Landing = () => {
  const navigate = useNavigate();
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [heroIdx, setHeroIdx] = useState(0);
  const [watchScreenIdx, setWatchScreenIdx] = useState(0);
  const heroVideoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  useEffect(() => {
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && isStandalone) navigate("/dashboard", { replace: true });
    });
  }, [navigate]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setWatchScreenIdx((i) => (i + 1) % WATCH_SCREENS.length);
    }, 2200);
    return () => window.clearInterval(id);
  }, []);

  const handleHeroEnded = (endedIndex: number) => {
    if (endedIndex !== heroIdx) return;
    const nextIndex = (endedIndex + 1) % HERO_VIDEOS.length;
    const nextVideo = heroVideoRefs.current[nextIndex];
    const showNextVideo = () => {
      if (nextVideo) {
        nextVideo.currentTime = 0;
        void nextVideo.play().catch(() => undefined);
      }
      setHeroIdx(nextIndex);
    };
    if (!nextVideo || nextVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      showNextVideo();
      return;
    }
    nextVideo.addEventListener("canplay", showNextVideo, { once: true });
    nextVideo.load();
  };

  useEffect(() => {
    heroVideoRefs.current.forEach((video, index) => {
      if (!video) return;
      if (index === heroIdx) void video.play().catch(() => undefined);
      else video.pause();
    });
  }, [heroIdx]);

  useEffect(() => {
    document.title = "Scarpers — Adaptive AI Running Coach for Garmin & Strava";

    const setMeta = (name: string, content: string) => {
      let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.name = name;
        document.head.appendChild(el);
      }
      const prev = el.content;
      el.content = content;
      return { el, prev };
    };
    const desc = setMeta(
      "description",
      "Adaptive running plans that adjust around your fitness, recovery and goals. Built for real runners using Garmin and Strava. Free personalised 5K, 10K, marathon and ultra training.",
    );
    const kw = setMeta(
      "keywords",
      "AI running coach, adaptive running plan, Garmin running coach, personalised marathon training plan, Strava training plan, 10K plan, ultra marathon training",
    );

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
        "Adaptive AI running coach with personalised plans for 5K, 10K, half marathon, marathon and ultra. Garmin and Strava integration.",
      url: "https://www.scarpers.co.uk/",
    });
    document.head.appendChild(org);

    return () => {
      ld.remove();
      org.remove();
      desc.el.content = desc.prev;
      kw.el.content = kw.prev;
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ====== HERO ====== */}
      <section className="relative isolate min-h-screen flex flex-col overflow-hidden">
        <div className="absolute inset-0 z-0 bg-background">
          {HERO_VIDEOS.map((src, index) => (
            <video
              key={src}
              ref={(node) => { heroVideoRefs.current[index] = node; }}
              src={src}
              autoPlay={index === 0}
              muted
              playsInline
              preload="auto"
              onEnded={() => handleHeroEnded(index)}
              aria-hidden="true"
              className={`absolute inset-0 w-full h-full object-cover ${index === heroIdx ? "opacity-100" : "opacity-0"}`}
            />
          ))}
        </div>
        <div className="absolute inset-0 z-[1] bg-black/70 pointer-events-none" />
        <div className="absolute inset-0 z-[1] bg-gradient-to-t from-black via-black/50 to-black/20 pointer-events-none" />

        <header className="relative z-20 px-5 sm:px-10 pt-6 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src={scarpersIcon} alt="" className="h-9 w-9 object-contain" />
            <img src={scarpersWordmark} alt="Scarpers" className="h-5 w-auto object-contain" />
          </Link>
          <nav className="flex items-center gap-1 sm:gap-3 text-sm">
            <a href="#how" className="hidden sm:inline px-3 py-2 text-foreground/80 hover:text-foreground">How it works</a>
            <a href="#features" className="hidden sm:inline px-3 py-2 text-foreground/80 hover:text-foreground">Features</a>
            <a href="#faq" className="hidden sm:inline px-3 py-2 text-foreground/80 hover:text-foreground">FAQ</a>
            <Button asChild variant="ghost" size="sm" className="text-foreground hover:text-foreground bg-background/30 backdrop-blur rounded-full">
              <Link to="/auth">Sign In</Link>
            </Button>
          </nav>
        </header>

        <div className="relative z-10 flex-1 flex items-end">
          <div className="px-5 sm:px-10 pb-16 sm:pb-24 max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border/60 bg-background/40 backdrop-blur text-[11px] font-medium text-foreground/80 mb-6">
              <Zap className="w-3 h-3 text-primary" />
              Adaptive coaching · Garmin & Strava
            </div>
            <h1
              className="text-4xl sm:text-6xl md:text-7xl font-bold tracking-tight leading-[0.95] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.85)]"
              style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
            >
              <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Never guess your next run again.
              </span>
            </h1>
            <p className="mt-6 text-base sm:text-lg text-white/90 max-w-xl leading-relaxed drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]">
              Adaptive running plans that adjust around your fitness, recovery, schedule and goals. Built for real runners using Garmin and Strava.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="h-12 px-7 rounded-full bg-gradient-to-r from-primary to-accent text-primary-foreground border-0 hover:opacity-90 text-base shadow-lg shadow-primary/30">
                <Link to="/auth">Start Free <ArrowRight className="w-4 h-4 ml-1" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 px-7 rounded-full text-base bg-background/40 backdrop-blur border-foreground/30 text-white hover:bg-background/60">
                <Link to="/auth"><Watch className="w-4 h-4 mr-1" /> Connect Garmin</Link>
              </Button>
            </div>

            {/* Integration row */}
            <div className="mt-10 flex items-center gap-5 text-xs uppercase tracking-[0.2em] text-white/70">
              <span>Works with</span>
              <span className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-background/40 backdrop-blur border border-border/40">
                <Watch className="w-3.5 h-3.5 text-primary" /> Garmin
              </span>
              <span className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-background/40 backdrop-blur border border-border/40">
                <Activity className="w-3.5 h-3.5 text-accent" /> Strava
              </span>
            </div>
          </div>
        </div>

        <a href="#dashboard" aria-label="Scroll" className="absolute bottom-5 left-1/2 -translate-x-1/2 text-foreground/70 animate-bounce z-10">
          <ChevronDown className="w-5 h-5" />
        </a>
      </section>

      {/* ====== PRODUCT MOCKUP ====== */}
      <section id="dashboard" className="relative bg-gradient-to-b from-background via-card/60 to-background border-y border-border/60">
        <div className="absolute inset-0 pointer-events-none opacity-50" style={{
          backgroundImage: "radial-gradient(circle at 20% 30%, hsl(var(--primary) / 0.22) 0%, transparent 50%), radial-gradient(circle at 80% 70%, hsl(var(--accent) / 0.18) 0%, transparent 50%)",
        }} />
        <div className="relative max-w-6xl mx-auto px-5 py-20 sm:py-28">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <SectionLabel>Your Run Today</SectionLabel>
              <H2>The plan that knows your week before you do.</H2>
              <p className="mt-5 text-muted-foreground leading-relaxed">
                Open the app and your next session is waiting — paced for the runner you actually are today, not who you were on Monday.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Button asChild size="lg" className="rounded-full bg-gradient-to-r from-primary to-accent text-primary-foreground border-0">
                  <Link to="/auth">Start Free <ArrowRight className="w-4 h-4 ml-1" /></Link>
                </Button>
              </div>
            </div>

            {/* Today's run card mockup */}
            <div className="relative">
              <div className="absolute -inset-4 bg-gradient-to-br from-primary/30 to-accent/30 blur-3xl opacity-60 rounded-3xl" />
              <article className="relative rounded-3xl border border-border/60 bg-card/90 backdrop-blur p-6 shadow-2xl">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Today · Tuesday</p>
                    <h3 className="mt-1 text-2xl font-bold" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>Threshold Intervals</h3>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Readiness</p>
                    <p className="text-2xl font-bold text-primary">82</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-5">
                  {[
                    { l: "Distance", v: "8.2 km" },
                    { l: "Avg HR", v: "162 bpm" },
                    { l: "Cadence", v: "178 spm" },
                  ].map((m) => (
                    <div key={m.l} className="rounded-xl bg-background/70 border border-border/40 p-3">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{m.l}</p>
                      <p className="mt-1 text-sm font-semibold">{m.v}</p>
                    </div>
                  ))}
                </div>

                <ul className="space-y-2 text-sm">
                  {[
                    { k: "Warm-up", v: "15 min · Z1–Z2" },
                    { k: "Main set", v: "5 × 4 min @ threshold" },
                    { k: "Recovery", v: "2 min easy jog" },
                    { k: "Cool-down", v: "10 min · Z1" },
                  ].map((r) => (
                    <li key={r.k} className="flex items-center justify-between border-b border-border/30 pb-2 last:border-0 last:pb-0">
                      <span className="text-muted-foreground">{r.k}</span>
                      <span className="font-medium">{r.v}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-5 flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/15 text-primary font-medium">
                    <Watch className="w-3 h-3" /> Synced to Garmin
                  </span>
                  <span className="text-muted-foreground">Target 172–180 bpm</span>
                </div>
              </article>
            </div>
          </div>
        </div>
      </section>

      {/* ====== HOW IT WORKS ====== */}
      <section id="how" className="bg-background">
        <div className="max-w-6xl mx-auto px-5 py-24 sm:py-28">
          <div className="text-center max-w-2xl mx-auto">
            <SectionLabel>How It Works</SectionLabel>
            <H2>From sign-up to smarter runs in two minutes.</H2>
          </div>
          <div className="mt-14 grid md:grid-cols-3 gap-5">
            {STEPS.map((s, i) => (
              <article
                key={s.n}
                className="relative rounded-2xl border border-border/50 bg-card/60 backdrop-blur p-7 hover:border-primary/40 transition-all"
              >
                <div className="absolute top-5 right-5 text-5xl font-bold text-primary/15" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
                  {s.n}
                </div>
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/25 to-accent/25 border border-border/50 flex items-center justify-center mb-5">
                  <s.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-xl font-bold" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>{s.title}</h3>
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{s.body}</p>
                {i < STEPS.length - 1 && (
                  <ChevronRight className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-primary/40" />
                )}
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ====== FEATURES ====== */}
      <section id="features" className="relative border-y border-border/40 bg-gradient-to-b from-primary/10 via-card/40 to-accent/10">
        <div className="max-w-6xl mx-auto px-5 py-24">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <SectionLabel>Features</SectionLabel>
            <H2>Everything an adaptive running coach should be.</H2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <article
                key={f.title}
                className="group rounded-2xl border border-border/50 bg-background/70 backdrop-blur p-6 hover:border-primary/40 hover:bg-background/90 transition-all"
              >
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 border border-border/40 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                  <f.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-lg font-bold" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ====== WATCH ====== */}
      <section id="watch" className="relative overflow-hidden bg-background border-b border-border/60">
        <div className="absolute inset-0 pointer-events-none opacity-50" style={{
          backgroundImage: "radial-gradient(circle at 15% 30%, hsl(var(--primary) / 0.18) 0%, transparent 50%), radial-gradient(circle at 85% 75%, hsl(var(--accent) / 0.16) 0%, transparent 50%)",
        }} />
        <div className="relative max-w-6xl mx-auto px-5 py-20 sm:py-28">
          <div className="grid md:grid-cols-2 gap-12 md:gap-8 items-center">
            <div>
              <SectionLabel>Garmin Sync</SectionLabel>
              <H2>Your plan, step by step, on your wrist.</H2>
              <p className="mt-5 text-muted-foreground leading-relaxed">
                Every Scarpers workout exports as a structured Garmin workout via Intervals.icu — warm-ups, intervals, recoveries and target heart rate zones, ready to start on your watch.
              </p>
              <ul className="mt-6 space-y-2 text-sm">
                {[
                  "Structured intervals with HR targets",
                  "Auto-import historical Strava activities",
                  "Sleep & readiness sync from Google Fit",
                  "FIT files always take priority",
                ].map((b) => (
                  <li key={b} className="flex items-start gap-3">
                    <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{b}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex justify-center">
              <WatchMockup
                frame={watchFenix8}
                frameAlt="Smartwatch showing a Scarpers workout"
                screenIndex={watchScreenIdx}
                screenStyle={FENIX8_SCREEN}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ====== SOCIAL PROOF ====== */}
      <section className="bg-background border-b border-border/40">
        <div className="max-w-6xl mx-auto px-5 py-24">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <SectionLabel>Built by runners</SectionLabel>
            <H2>Loved by real runners chasing real goals.</H2>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-12">
            {STATS.map((s) => (
              <div key={s.label} className="rounded-2xl border border-border/50 bg-card/60 backdrop-blur p-5 text-center">
                <p className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
                  {s.value}
                </p>
                <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Testimonials */}
          <div className="grid md:grid-cols-3 gap-4">
            {TESTIMONIALS.map((t) => (
              <article key={t.name} className="rounded-2xl border border-border/50 bg-card/60 backdrop-blur p-6">
                <Quote className="w-5 h-5 text-primary/60 mb-3" />
                <p className="text-sm leading-relaxed">{t.body}</p>
                <div className="mt-5 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.goal}</p>
                  </div>
                  <div className="flex gap-0.5 text-primary">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} className="w-3.5 h-3.5 fill-current" />
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>

          {/* Race goals */}
          <div className="mt-10 flex flex-wrap justify-center gap-2">
            {["5K", "10K", "Half Marathon", "Marathon", "50K Ultra", "100K Trail"].map((d) => (
              <span key={d} className="px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider border border-border/50 bg-card/60 backdrop-blur">
                {d}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ====== COMPARISON ====== */}
      <section className="relative bg-gradient-to-b from-background via-card/40 to-background border-b border-border/40">
        <div className="max-w-5xl mx-auto px-5 py-24">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <SectionLabel>The Difference</SectionLabel>
            <H2>Why runners switch to Scarpers.</H2>
            <p className="mt-5 text-muted-foreground leading-relaxed">
              Static plans don't know you missed Tuesday. Generic apps don't read your heart rate. Scarpers does both — and rebuilds your week accordingly.
            </p>
          </div>

          <div className="rounded-2xl border border-border/50 bg-card/60 backdrop-blur overflow-hidden">
            <div className="grid grid-cols-4 gap-2 px-5 py-4 border-b border-border/40 text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
              <div className="col-span-1">Feature</div>
              <div className="text-center text-primary">Scarpers</div>
              <div className="text-center">Static plan</div>
              <div className="text-center">Generic app</div>
            </div>
            {COMPARISON.map((row, i) => (
              <div key={row.feature} className={`grid grid-cols-4 gap-2 px-5 py-3.5 text-sm items-center ${i % 2 ? "bg-background/30" : ""}`}>
                <div className="col-span-1 font-medium">{row.feature}</div>
                {[row.scarpers, row.static, row.generic].map((v, j) => (
                  <div key={j} className="text-center">
                    {v === true ? (
                      <Check className="w-4 h-4 text-primary inline" />
                    ) : v === false ? (
                      <X className="w-4 h-4 text-muted-foreground/50 inline" />
                    ) : (
                      <span className="text-xs text-muted-foreground">{v}</span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ====== Blog ====== */}
      <section className="border-t border-border/40 bg-background">
        <div className="max-w-6xl mx-auto px-5 py-20">
          <BlogPreview
            heading="From the Scarpers blog"
            subheading="Training advice, race day tips and adaptive coaching insights."
          />
        </div>
      </section>

      {/* ====== FAQ ====== */}
      <section id="faq" className="bg-gradient-to-b from-background via-card/70 to-background border-y border-border/60">
        <div className="max-w-3xl mx-auto px-5 py-24">
          <div className="text-center mb-12">
            <SectionLabel>FAQ</SectionLabel>
            <H2>Everything you need to know.</H2>
          </div>
          <div className="space-y-3">
            {FAQS.map((f, i) => {
              const open = openFaq === i;
              return (
                <div key={f.q} className="rounded-2xl border border-border/50 bg-background/70 backdrop-blur overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(open ? null : i)}
                    className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-background/90 transition"
                    aria-expanded={open}
                  >
                    <span className="text-sm sm:text-base font-semibold">{f.q}</span>
                    <ChevronDown className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
                  </button>
                  {open && <div className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed">{f.a}</div>}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ====== FINAL CTA ====== */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary/30 via-background to-accent/30">
        <div className="absolute inset-0 -z-0 opacity-40" style={{
          backgroundImage: "radial-gradient(circle at 30% 20%, hsl(var(--primary)) 0%, transparent 50%), radial-gradient(circle at 80% 80%, hsl(var(--accent)) 0%, transparent 50%)",
        }} />
        <div className="relative max-w-3xl mx-auto px-5 py-24 sm:py-32 text-center">
          <H2>Your next PB starts with your next run.</H2>
          <p className="mt-5 text-lg text-foreground/80 max-w-xl mx-auto">
            Free during beta. Connect Garmin or Strava and get an adaptive plan in under two minutes.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="h-12 px-8 rounded-full bg-foreground text-background hover:bg-foreground/90 text-base">
              <Link to="/auth">Start Free <ArrowRight className="w-4 h-4 ml-1" /></Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 px-8 rounded-full text-base border-foreground/30">
              <Link to="/auth"><Watch className="w-4 h-4 mr-1" /> Connect Garmin</Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/40 bg-card/30 backdrop-blur">
        <div className="max-w-6xl mx-auto px-5 py-10 grid sm:grid-cols-3 gap-6 text-sm">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <img src={scarpersIcon} alt="" className="h-7 w-7 object-contain" />
              <img src={scarpersWordmark} alt="Scarpers" className="h-4 w-auto object-contain" />
            </div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Adaptive running plans built around your fitness, recovery and goals. Garmin and Strava native.
            </p>
          </div>
          <div>
            <p className="font-semibold mb-3">Product</p>
            <ul className="space-y-2 text-muted-foreground">
              <li><a href="#how" className="hover:text-foreground">How it works</a></li>
              <li><a href="#features" className="hover:text-foreground">Features</a></li>
              <li><a href="#watch" className="hover:text-foreground">Garmin sync</a></li>
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

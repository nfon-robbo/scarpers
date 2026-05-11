import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Activity,
  Brain,
  Calendar,
  ChevronDown,
  ChevronRight,
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

// Circular screen position as % of frame image (1024x1536)
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
        <div
          className="absolute overflow-hidden rounded-full bg-black"
          style={screenStyle}
        >
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
    q: "What is Scarpers?",
    a: "Scarpers is an AI running coach that builds free personalised training plans for 5K, 10K, half marathon, marathon and ultra. It reads your real running data, sleep and readiness, then writes a week-by-week plan tailored to you.",
  },
  {
    q: "Is Scarpers free?",
    a: "Yes. Scarpers is free to use — sign up, complete onboarding and your personalised AI running plan is generated in under two minutes.",
  },
  {
    q: "How does the AI generate my plan?",
    a: "Onboarding captures your goal, experience, weekly mileage, HR zones and any injuries. Scarpers then analyses your last 8 weeks of activities and 30 nights of sleep before writing a week-by-week plan with paces, intensities and target heart rates.",
  },
  {
    q: "Can I use Scarpers if I have an injury?",
    a: "Yes. Onboarding asks about current and recent injuries. The AI scales weekly volume, reduces high-impact sessions and swaps in lower-stress alternatives so you can keep training safely.",
  },
  {
    q: "Does Scarpers work with Garmin watches?",
    a: "Yes. Import .FIT files from any Garmin watch and export structured workouts to Intervals.icu — your watch then picks up the session with target heart rate zones and intervals.",
  },
  {
    q: "What running distances does Scarpers support?",
    a: "5K, 10K, half marathon, marathon and ultra (50K, 50mi, 100K trail). Plans range from 6 to 24 weeks depending on the distance and your starting fitness.",
  },
  {
    q: "Is Scarpers suitable for complete beginners?",
    a: "Yes. If you're new to running, Scarpers builds a gentle run-walk progression that grows safely week by week, with easy paces and recovery built in.",
  },
  {
    q: "How is Scarpers different from Couch to 5K?",
    a: "Couch to 5K is a single fixed plan for everyone. Scarpers writes a unique plan from your data — fitness level, injuries, sleep, readiness and HR zones — and adapts day-to-day based on how your training is actually going.",
  },
];

const STEPS = [
  {
    icon: Target,
    n: "STEP 1",
    title: "Tell Us About Your Running",
    body: "Pick your race distance, share your experience, weekly mileage and any injuries — our system does the rest.",
  },
  {
    icon: Upload,
    n: "STEP 2",
    title: "Get Your Personalised Plan",
    body: "Our AI running coach builds a week-by-week plan tailored to your goal, fitness and recovery — in under two minutes.",
  },
  {
    icon: Calendar,
    n: "STEP 3",
    title: "Train, Adapt, Race",
    body: "Daily readiness, smart pacing, music BPM cues and post-run reviews keep you progressing without overtraining.",
  },
];

const FEATURES = [
  { icon: Brain, title: "Personalised AI Training Plan", body: "Every plan is unique — built from your real running data, not generic templates." },
  { icon: Heart, title: "Daily Readiness Score", body: "Sleep, resting HR, HRV and load combined into one honest push-or-back-off score." },
  { icon: LineChart, title: "Running IQ", body: "A 0–200 score across durability, consistency, progression, recovery and pace." },
  { icon: Moon, title: "Sleep Tracking", body: "365-day sleep calendar with stages from Google Fit and your watch." },
  { icon: Sparkles, title: "Day-Ahead Coach", body: "Wake up to a smart preview of today's run, adapted to last night's sleep." },
  { icon: Activity, title: "Post-Run Reviews", body: "Every run gets an AI debrief: what went well, what to build on, what's next." },
];

const PLANS = [
  { distance: "5K", weeks: "6–8 weeks", who: "First-timers & PB chasers" },
  { distance: "10K", weeks: "8–10 weeks", who: "Building speed and endurance" },
  { distance: "Half Marathon", weeks: "12 weeks", who: "Most popular distance" },
  { distance: "Marathon", weeks: "16–20 weeks", who: "London, Berlin, NYC, Boston" },
  { distance: "Ultra", weeks: "20–24 weeks", who: "50K, 50mi, 100K trail" },
];

const SectionLabel = ({ children, light }: { children: React.ReactNode; light?: boolean }) => (
  <p className={`text-xs sm:text-sm font-semibold tracking-[0.2em] uppercase ${light ? "text-primary-foreground/80" : "text-primary"}`}>{children}</p>
);

const H2 = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mt-3 text-3xl sm:text-5xl font-bold tracking-tight leading-[1.05]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
    {children}
  </h2>
);

const Landing = () => {
  const navigate = useNavigate();
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [heroIdx, setHeroIdx] = useState(0);
  const [watchScreenIdx, setWatchScreenIdx] = useState(0);
  const heroVideoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  // If already logged in (e.g. PWA relaunch), jump straight to the app
  useEffect(() => {
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // iOS Safari
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
      if (index === heroIdx) {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    });
  }, [heroIdx]);

  useEffect(() => {
    document.title = "Scarpers — AI Running Coach | Free Personalised 5K & 10K Training Plans";

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
      description: "AI running coach that builds personalised training plans for 5K, 10K, half marathon, marathon and ultra distances.",
      url: "https://www.scarpers.co.uk/",
    });
    document.head.appendChild(org);

    return () => { ld.remove(); org.remove(); };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ====== HERO — full-bleed runner photo ====== */}
      <section className="relative isolate min-h-screen flex flex-col overflow-hidden">
        {/* Background video + overlays */}
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
        <div className="absolute inset-0 z-[1] bg-gradient-to-r from-background/55 via-background/20 to-transparent pointer-events-none" />
        <div className="absolute inset-0 z-[1] bg-gradient-to-t from-background/45 via-background/5 to-transparent pointer-events-none" />
        <div className="absolute inset-0 z-[1] bg-black/80 pointer-events-none" />

        {/* Top nav */}
        <header className="relative z-20 px-5 sm:px-10 pt-6 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src={scarpersIcon} alt="" className="h-9 w-9 object-contain" />
            <img src={scarpersWordmark} alt="Scarpers" className="h-5 w-auto object-contain" />
          </Link>
          <Button asChild variant="ghost" size="sm" className="text-foreground hover:text-foreground bg-background/30 backdrop-blur rounded-full">
            <Link to="/auth">Sign In</Link>
          </Button>
        </header>

        {/* Hero copy bottom-left */}
        <div className="relative z-10 flex-1 flex items-end">
          <div className="px-5 sm:px-10 pb-20 sm:pb-28 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border/60 bg-background/40 backdrop-blur text-[11px] font-medium text-foreground/80 mb-6">
              <Zap className="w-3 h-3 text-primary" />
              AI running coach · Beta
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[0.95] text-white drop-shadow-lg" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              AI Running<br />Coach
            </h1>
            <p className="mt-6 text-base sm:text-lg text-white max-w-md leading-relaxed drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]">
              Free personalised running plans for 5K, 10K, half, marathon &amp; ultra — built around your fitness, injuries and goals.
            </p>
            <p className="mt-3 text-sm sm:text-base text-white/90 max-w-md leading-relaxed drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]">
              Available on desktop, mobile and tablet.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="h-12 px-7 rounded-full bg-gradient-to-r from-primary to-accent text-primary-foreground border-0 hover:opacity-90 text-base">
                <Link to="/auth">Get Your Plan</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 px-7 rounded-full text-base bg-background/40 backdrop-blur border-foreground/20">
                <a href="#watch">See It On Watch</a>
              </Button>
            </div>
          </div>
        </div>

        <a href="#watch" aria-label="Scroll to watch preview" className="absolute bottom-5 left-1/2 -translate-x-1/2 text-foreground/70 animate-bounce z-10">
          <ChevronDown className="w-5 h-5" />
        </a>
      </section>

      {/* ====== HERO 2 — ON YOUR WATCH ====== */}
      <section id="watch" className="relative overflow-hidden bg-gradient-to-b from-background via-card/60 to-background border-y border-border/60 scroll-mt-0">
        <div className="absolute inset-0 pointer-events-none opacity-60" style={{
          backgroundImage: "radial-gradient(circle at 15% 30%, hsl(var(--primary) / 0.25) 0%, transparent 50%), radial-gradient(circle at 85% 75%, hsl(var(--accent) / 0.22) 0%, transparent 50%)",
        }} />
        <div className="relative max-w-6xl mx-auto px-5 py-20 sm:py-28">
          <div className="grid md:grid-cols-2 gap-12 md:gap-8 items-center">
            <div className="order-1 md:order-1">
              <SectionLabel>On Your Watch</SectionLabel>
              <h2 className="mt-3 text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[0.95]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Your AI plan,<br />
                <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">right on your wrist</span>
              </h2>
              <p className="mt-6 text-base sm:text-lg text-muted-foreground max-w-md leading-relaxed">
                Every Scarpers workout exports as a structured workout — warm-ups, intervals, recoveries and pace targets all show up step-by-step on your wrist.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button asChild size="lg" className="h-12 px-7 rounded-full bg-gradient-to-r from-primary to-accent text-primary-foreground border-0 hover:opacity-90 text-base">
                  <Link to="/auth">Get Your Plan</Link>
                </Button>
              </div>
            </div>
            <div className="order-2 md:order-2 flex justify-center">
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

      {/* ====== HOW IT WORKS — default dark band ====== */}
      <section id="how" className="bg-background">
        <div className="max-w-6xl mx-auto px-5 py-24 sm:py-32">
          <div className="text-center max-w-2xl mx-auto">
            <SectionLabel>How It Works</SectionLabel>
            <H2>Three Steps to Your Best Race</H2>
          </div>
          <div className="mt-16 grid md:grid-cols-3 gap-6">
            {STEPS.map((s) => (
              <article key={s.n} className="text-center">
                <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 border border-border/50 flex items-center justify-center mb-5">
                  <s.icon className="w-7 h-7 text-primary" />
                </div>
                <p className="text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground">{s.n}</p>
                <h3 className="mt-2 text-xl font-bold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{s.title}</h3>
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{s.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ====== PLANS — tinted card band ====== */}
      <section id="plans" className="relative bg-gradient-to-br from-primary/15 via-card/80 to-accent/15 border-y border-border/60">
        <div className="absolute inset-0 -z-0 opacity-40 pointer-events-none" style={{
          backgroundImage: "radial-gradient(circle at 10% 20%, hsl(var(--primary) / 0.15) 0%, transparent 40%), radial-gradient(circle at 90% 80%, hsl(var(--accent) / 0.15) 0%, transparent 40%)",
        }} />
        <div className="relative max-w-6xl mx-auto px-5 py-24">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <SectionLabel>Training Plans</SectionLabel>
              <H2>From your first 5K to your first 100K</H2>
              <p className="mt-5 text-muted-foreground leading-relaxed">
                Pick your distance, set your race date, and Scarpers writes a plan that peaks you on the right day — with a real taper, recovery weeks and intensity that scales to your fitness.
              </p>
              <Button asChild size="lg" className="mt-7 rounded-full bg-gradient-to-r from-primary to-accent text-primary-foreground border-0">
                <Link to="/auth">Build my plan <ChevronRight className="w-4 h-4 ml-1" /></Link>
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {PLANS.map((p) => (
                <div key={p.distance} className={`rounded-2xl border border-border/50 bg-background/70 backdrop-blur p-5 ${p.distance === "Ultra" ? "col-span-2" : ""}`}>
                  <p className="text-[11px] text-muted-foreground">{p.weeks}</p>
                  <h3 className="mt-1 text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{p.distance}</h3>
                  <p className="mt-2 text-xs text-muted-foreground">{p.who}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ====== IMPORTS — back to dark ====== */}
      <section className="bg-background">
        <div className="max-w-6xl mx-auto px-5 py-24">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="order-2 lg:order-1 rounded-3xl border border-border/50 bg-gradient-to-br from-card/80 to-card/40 backdrop-blur p-8">
              <div className="grid grid-cols-2 gap-3">
                {["Garmin","Strava","Google Fit","Intervals.icu"].map((b) => (
                  <div key={b} className="rounded-xl border border-border/40 bg-background/60 p-4 flex items-center gap-2 text-sm font-medium">
                    <Watch className="w-4 h-4 text-primary shrink-0" />
                    {b}
                  </div>
                ))}
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <SectionLabel>One Tap Import</SectionLabel>
              <H2>Bring your runs from anywhere</H2>
              <p className="mt-5 text-muted-foreground leading-relaxed">
                Drop a .FIT file from your Garmin or connect Strava once — Scarpers de-duplicates, parses GPS, heart rate and pace, and starts learning how you actually run. Google Fit sleep syncs automatically.
              </p>
              <ul className="mt-6 space-y-3 text-sm">
                {[
                  "FIT files always take priority over duplicates",
                  "Strava OAuth — no manual exports",
                  "Google Fit sleep sync",
                  "Auto-merges sensor and watch data",
                ].map((b) => (
                  <li key={b} className="flex items-start gap-3">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-gradient-to-r from-primary to-accent shrink-0" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ====== FEATURES — gradient band ====== */}
      <section id="features" className="relative border-y border-border/40 bg-gradient-to-b from-primary/10 via-card/40 to-accent/10">
        <div className="max-w-6xl mx-auto px-5 py-24">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <SectionLabel>Features</SectionLabel>
            <H2>Everything Your Running Needs</H2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <article key={f.title} className="group rounded-2xl border border-border/50 bg-background/70 backdrop-blur p-6 hover:border-primary/40 hover:bg-background/90 transition-all">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 border border-border/40 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                  <f.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-lg font-bold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ====== WHAT IS IT? — dark band ====== */}
      <section className="bg-background">
        <div className="max-w-6xl mx-auto px-5 py-24">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <SectionLabel>What Is It?</SectionLabel>
            <H2>What Is a Smart AI Running Coach?</H2>
            <p className="mt-5 text-muted-foreground leading-relaxed">
              A smart AI running coach is a digital training partner that reads your real running data and writes a plan only you should be running — no generic templates, no guesswork.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {[
              { icon: Brain, title: "What It Does", body: "Scarpers takes information about your running — recent runs, sleep, resting HR, goal race and experience — and uses AI to build a bespoke week-by-week plan. It tells you exactly what to run and when, with intensity targets, music BPM cues and a real race-day taper." },
              { icon: Heart, title: "Why You Need One", body: "Generic plans give every runner the same Tuesday tempo. They don't know if you slept four hours, ran a half-marathon at the weekend, or are coming back from a calf strain. A smart coach reads your data and adapts — preventing injury and overtraining while keeping you progressing." },
              { icon: Sparkles, title: "How It Works", body: "Onboarding takes under two minutes. Tell us your race, experience and any niggles, then drop in a FIT file or connect Strava. Within seconds you have a complete plan with daily readiness, post-run reviews and a 24/7 AI coach you can chat to." },
              { icon: Target, title: "Why Scarpers", body: "Scarpers is the UK's most comprehensive AI running coach. Personalised plans, daily readiness, Running IQ, sleep tracking, post-run reviews, and one-click Intervals.icu export — on web, iOS and Android." },
            ].map((c) => (
              <article key={c.title} className="rounded-2xl border border-border/50 bg-card/60 backdrop-blur p-7">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 border border-border/40 flex items-center justify-center">
                    <c.icon className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{c.title}</h3>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{c.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ====== FAQ — tinted card band ====== */}
      <section id="faq" className="bg-gradient-to-b from-background via-card/70 to-background border-y border-border/60">
        <div className="max-w-3xl mx-auto px-5 py-24">
          <div className="text-center mb-14">
            <SectionLabel>FAQ</SectionLabel>
            <H2>Frequently Asked Questions</H2>
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

      {/* ====== FINAL CTA — full gradient band ====== */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary/30 via-background to-accent/30">
        <div className="absolute inset-0 -z-0 opacity-40" style={{
          backgroundImage: "radial-gradient(circle at 30% 20%, hsl(var(--primary)) 0%, transparent 50%), radial-gradient(circle at 80% 80%, hsl(var(--accent)) 0%, transparent 50%)",
        }} />
        <div className="relative max-w-3xl mx-auto px-5 py-24 sm:py-32 text-center">
          <H2>Ready to Transform Your Running?</H2>
          <p className="mt-5 text-lg text-foreground/80 max-w-xl mx-auto">
            Join thousands of runners who've taken the guesswork out of training.
          </p>
          <Button asChild size="lg" className="mt-8 h-12 px-8 rounded-full bg-foreground text-background hover:bg-foreground/90 text-base">
            <Link to="/auth">Get Your Plan</Link>
          </Button>
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
              The AI running coach that reads your data and writes the plan only you should be running.
            </p>
          </div>
          <div>
            <p className="font-semibold mb-3">Product</p>
            <ul className="space-y-2 text-muted-foreground">
              <li><a href="#how" className="hover:text-foreground">How it works</a></li>
              <li><a href="#plans" className="hover:text-foreground">Training plans</a></li>
              <li><a href="#features" className="hover:text-foreground">Features</a></li>
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

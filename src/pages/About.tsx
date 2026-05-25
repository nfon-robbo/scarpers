import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import MarketingPageLayout from "@/components/MarketingPageLayout";
import CoachClaireCard from "@/components/CoachClaireCard";

const About = () => {
  useEffect(() => {
    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.text = JSON.stringify([
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "Scarpers",
        url: "https://www.scarpers.co.uk/",
        logo: "https://www.scarpers.co.uk/og-image.png",
        email: "hello@scarpers.co.uk",
        description: "Independent UK-built AI running coach offering free personalised training plans for 5K, 10K, half, marathon and ultra.",
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://www.scarpers.co.uk/" },
          { "@type": "ListItem", position: 2, name: "About", item: "https://www.scarpers.co.uk/about" },
        ],
      },
    ]);
    document.head.appendChild(ld);
    return () => { ld.remove(); };
  }, []);

  return (
  <MarketingPageLayout
    title="About Scarpers — The AI Running Coach Behind Your Plan"
    description="Scarpers is an independent UK-built AI running coach. Learn who's behind it, how plans are generated, our editorial standards and how to contact us."
    canonicalPath="/about"
  >
    <article className="prose prose-invert max-w-none">
      <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
        About Scarpers
      </h1>
      <p className="text-lg text-muted-foreground leading-relaxed">
        Scarpers is an independent, UK-built AI running coach that writes free personalised training plans for
        5K, 10K, half marathon, marathon and ultra distances. We started Scarpers because the running plans we
        could find online were either rigid one-size-fits-all spreadsheets or premium subscriptions hidden behind
        a paywall. Runners deserve a plan that adapts to their real life, real data and real injuries — without
        a credit card.
      </p>

      <h2 className="text-2xl font-semibold mt-10 mb-3">Who's behind Scarpers</h2>
      <p className="text-muted-foreground leading-relaxed">
        Scarpers is built and maintained by a small UK-based team of runners and engineers. Our AI coaching
        persona, <strong>Coach Claire Rayners</strong>, is the voice of every plan, day-ahead briefing and
        post-run review. Claire is an AI persona — she is not a real person and does not replace a qualified
        coach, physiotherapist or medical professional. The principles behind her recommendations are drawn
        from established endurance training literature (polarised training, heart-rate zone models, conservative
        load progression) and reviewed by the team before being shipped.
      </p>

      <div className="not-prose mt-6">
        <CoachClaireCard variant="compact" />
      </div>

      <h2 className="text-2xl font-semibold mt-10 mb-3">How plans are generated</h2>
      <p className="text-muted-foreground leading-relaxed">
        Onboarding captures your goal distance, target date, weekly mileage, experience level, current and
        recent injuries, and your heart-rate zones. Where you've connected Strava or imported FIT files,
        Scarpers analyses your last eight weeks of activity and your last 30 nights of sleep before writing the
        plan. Each session prescribes intensity (easy, steady, tempo, threshold, VO2), duration, target heart
        rate and a music BPM cue for cadence. Plans adapt week by week based on readiness and what you actually
        run.
      </p>

      <h2 className="text-2xl font-semibold mt-10 mb-3">Our editorial standards</h2>
      <ul className="list-disc pl-6 text-muted-foreground space-y-1 mt-2">
        <li>Plans cap weekly load increases and deload when readiness drops.</li>
        <li>Injury history shapes every session — no high-impact sessions are scheduled against an active flag.</li>
        <li>We never recommend training through pain. The AI explicitly defers to a physio or doctor.</li>
        <li>Blog posts are written or reviewed by the team. We cite primary sources where useful.</li>
        <li>We do not accept paid placements or sponsored content disguised as editorial.</li>
      </ul>

      <h2 className="text-2xl font-semibold mt-10 mb-3">Safety &amp; medical disclaimer</h2>
      <p className="text-muted-foreground leading-relaxed">
        Scarpers is a training tool, not medical advice. If you're injured, returning from surgery, pregnant,
        managing a chronic condition or new to exercise, please speak to a qualified physio or doctor before
        starting any plan. See our{" "}
        <Link to="/privacy" className="text-primary underline">privacy policy</Link> and{" "}
        <Link to="/terms" className="text-primary underline">terms</Link> for the full disclaimer.
      </p>

      <h2 className="text-2xl font-semibold mt-10 mb-3">Contact</h2>
      <p className="text-muted-foreground leading-relaxed">
        For editorial queries, corrections, partnership requests or data questions, email{" "}
        <a className="text-primary underline" href="mailto:hello@scarpers.co.uk">hello@scarpers.co.uk</a>. We
        read everything and try to reply within a few working days.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild size="lg" className="rounded-full">
          <Link rel="nofollow" to="/auth">Get my free plan</Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="rounded-full">
          <Link to="/ai-running-coach">How the AI works</Link>
        </Button>
      </div>
    </article>
  </MarketingPageLayout>
  );
};

export default About;

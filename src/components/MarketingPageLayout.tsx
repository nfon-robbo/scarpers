import { ReactNode, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import scarpersIcon from "@/assets/scarpers-icon.png";
import scarpersWordmark from "@/assets/scarpers-wordmark.png";

interface Props {
  title: string;
  description: string;
  canonicalPath: string;
  noindex?: boolean;
  children: ReactNode;
}

const MarketingPageLayout = ({ title, description, canonicalPath, noindex, children }: Props) => {
  useEffect(() => {
    document.title = title;

    const setMeta = (name: string, content: string) => {
      let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.name = name;
        document.head.appendChild(el);
      }
      el.content = content;
      return el;
    };

    const desc = setMeta("description", description);
    const robots = noindex ? setMeta("robots", "noindex, follow") : null;

    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const prevCanonical = canonical?.href ?? null;
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = `https://www.scarpers.co.uk${canonicalPath}`;

    return () => {
      if (prevCanonical && canonical) canonical.href = prevCanonical;
      if (robots) robots.remove();
    };
  }, [title, description, canonicalPath, noindex]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/40 bg-card/30 backdrop-blur">
        <div className="max-w-6xl mx-auto px-5 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src={scarpersIcon} alt="" className="h-8 w-8 object-contain" />
            <img src={scarpersWordmark} alt="Scarpers" className="h-5 w-auto object-contain" />
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            <Link to="/ai-running-coach" className="hidden sm:inline text-muted-foreground hover:text-foreground">AI Coach</Link>
            <Link to="/5k-training-plan" className="hidden sm:inline text-muted-foreground hover:text-foreground">5K Plan</Link>
            <Link to="/10k-training-plan" className="hidden sm:inline text-muted-foreground hover:text-foreground">10K Plan</Link>
            <Button asChild size="sm" className="rounded-full">
              <Link to="/auth">Sign in</Link>
            </Button>
          </nav>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-5 py-12 sm:py-16">{children}</main>
      <footer className="border-t border-border/40 bg-card/30 backdrop-blur mt-12">
        <div className="max-w-6xl mx-auto px-5 py-8 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-3">
          <span>© {new Date().getFullYear()} Scarpers · scarpers.co.uk</span>
          <div className="flex gap-4">
            <Link to="/" className="hover:text-foreground">Home</Link>
            <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link to="/auth" className="hover:text-foreground">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default MarketingPageLayout;

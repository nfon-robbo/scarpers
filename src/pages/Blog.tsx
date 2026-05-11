import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import MarketingPageLayout from "@/components/MarketingPageLayout";

const Blog = () => (
  <MarketingPageLayout
    title="Scarpers Running Blog — Coming Soon"
    description="The Scarpers running blog is launching soon — training tips, AI coaching insights and race-day guides for 5K to ultra runners."
    canonicalPath="/blog"
    noindex
  >
    <article className="text-center py-10">
      <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
        Scarpers Running Blog
      </h1>
      <p className="text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
        Training tips, AI coaching insights and race-day guides are on the way. In the meantime, grab your free
        personalised plan and start training.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button asChild size="lg" className="rounded-full">
          <Link to="/auth">Get my free plan</Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="rounded-full">
          <Link to="/ai-running-coach">How it works</Link>
        </Button>
      </div>
    </article>
  </MarketingPageLayout>
);

export default Blog;

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, BookOpen } from "lucide-react";
import MarketingPageLayout from "@/components/MarketingPageLayout";

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  cover_image: string | null;
  published_at: string | null;
}

const Blog = () => {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("blog_posts")
        .select("id, title, slug, excerpt, cover_image, published_at")
        .eq("published", true)
        .lte("published_at", new Date().toISOString())
        .order("published_at", { ascending: false });
      setPosts((data as BlogPost[]) || []);
      setLoading(false);
    };
    load();
  }, []);

  return (
    <MarketingPageLayout
      title="Scarpers Running Blog — AI Coaching & Training Tips"
      description="Expert running advice, AI coaching insights, training plan guides and race day tips from the team at Scarpers."
      canonicalPath="/blog"
    >
      <div className="text-center mb-10">
        <p className="text-xs font-semibold tracking-widest uppercase text-primary mb-2">From the Coach</p>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
          Scarpers Running Blog
        </h1>
        <p className="text-muted-foreground mt-3 max-w-lg mx-auto">
          Training advice, race day tips and AI coaching insights for runners chasing 5K, 10K, half, marathon and ultra.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No blog posts yet — check back soon!</p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          {posts.map((post) => (
            <Link
              key={post.id}
              to={`/blog/${post.slug}`}
              className="group rounded-2xl border border-border bg-card overflow-hidden shadow-sm hover:shadow-md transition-shadow"
            >
              {post.cover_image ? (
                <img src={post.cover_image} alt={post.title} className="w-full h-44 object-cover group-hover:scale-[1.02] transition-transform" loading="lazy" />
              ) : (
                <div className="w-full h-44 bg-primary/5 flex items-center justify-center">
                  <BookOpen className="h-8 w-8 text-primary/30" />
                </div>
              )}
              <div className="p-5">
                <h2 className="text-lg font-bold text-foreground group-hover:text-primary transition-colors line-clamp-2" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
                  {post.title}
                </h2>
                {post.excerpt && (
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-2 leading-relaxed">{post.excerpt}</p>
                )}
                {post.published_at && (
                  <p className="text-[11px] text-muted-foreground/60 mt-3">
                    {new Date(post.published_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </MarketingPageLayout>
  );
};

export default Blog;

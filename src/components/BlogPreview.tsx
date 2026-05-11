import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { BookOpen, ArrowRight } from "lucide-react";

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  cover_image: string | null;
  published_at: string | null;
}

interface BlogPreviewProps {
  limit?: number;
  heading?: string;
  subheading?: string;
  className?: string;
}

const BlogPreview = ({
  limit = 3,
  heading = "From the blog",
  subheading = "Training advice, race day tips and AI coaching insights.",
  className = "",
}: BlogPreviewProps) => {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("blog_posts")
        .select("id, title, slug, excerpt, cover_image, published_at")
        .eq("published", true)
        .order("published_at", { ascending: false })
        .limit(limit);
      setPosts((data as BlogPost[]) || []);
      setLoading(false);
    };
    load();
  }, [limit]);

  if (loading || posts.length === 0) return null;

  return (
    <section className={`w-full ${className}`}>
      <div className="flex items-end justify-between mb-6 gap-4">
        <div>
          <h2
            className="text-2xl sm:text-3xl font-bold tracking-tight"
            style={{ fontFamily: "'Bebas Neue', sans-serif" }}
          >
            {heading}
          </h2>
          {subheading && (
            <p className="text-sm text-muted-foreground mt-1">{subheading}</p>
          )}
        </div>
        <Link
          to="/blog"
          className="text-sm font-semibold text-primary hover:underline shrink-0 inline-flex items-center gap-1"
        >
          View all <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => (
          <Link
            key={post.id}
            to={`/blog/${post.slug}`}
            className="group rounded-2xl border border-border bg-card overflow-hidden shadow-sm hover:shadow-md transition-shadow"
          >
            {post.cover_image ? (
              <img
                src={post.cover_image}
                alt={post.title}
                className="w-full h-36 object-cover group-hover:scale-[1.02] transition-transform"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-36 bg-primary/5 flex items-center justify-center">
                <BookOpen className="h-7 w-7 text-primary/30" />
              </div>
            )}
            <div className="p-4">
              <h3
                className="text-base font-bold text-foreground group-hover:text-primary transition-colors line-clamp-2"
                style={{ fontFamily: "'Bebas Neue', sans-serif" }}
              >
                {post.title}
              </h3>
              {post.excerpt && (
                <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">
                  {post.excerpt}
                </p>
              )}
              {post.published_at && (
                <p className="text-[10px] text-muted-foreground/60 mt-2">
                  {new Date(post.published_at).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
};

export default BlogPreview;

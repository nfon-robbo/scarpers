import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Calendar, ArrowLeft, Pencil } from "lucide-react";
import DOMPurify from "dompurify";
import MarketingPageLayout from "@/components/MarketingPageLayout";
import BlogInteractions from "@/components/BlogInteractions";

interface Post {
  id: string;
  title: string;
  slug: string;
  content: string;
  cover_image: string | null;
  published_at: string | null;
  excerpt: string | null;
}

function renderContent(content: string): string {
  if (content.trimStart().startsWith("<")) return content;
  // Legacy markdown fallback
  const html = content
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');
  return `<p>${html}</p>`;
}

const BlogPost = () => {
  const { slug } = useParams<{ slug: string }>();
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setIsAdmin(false); return; }
      const { data } = await supabase.rpc("has_role", { _user_id: session.user.id, _role: "admin" });
      setIsAdmin(!!data);
    })();
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!slug) { setNotFound(true); setLoading(false); return; }

      const params = new URLSearchParams(window.location.search);
      const preview = params.get("preview") === "true";

      if (preview) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: session.user.id, _role: "admin" });
          if (isAdmin) {
            const { data } = await supabase.from("blog_posts").select("*").eq("slug", slug).maybeSingle();
            if (data) {
              setPost(data as Post);
              setIsPreview(!data.published);
              setLoading(false);
              return;
            }
          }
        }
      }

      const { data } = await supabase
        .from("blog_posts")
        .select("*")
        .eq("slug", slug)
        .eq("published", true)
        .maybeSingle();

      if (!data) setNotFound(true);
      else setPost(data as Post);
      setLoading(false);
    };
    load();
  }, [slug]);

  // Inject Article + BreadcrumbList JSON-LD
  useEffect(() => {
    if (!post) return;
    const article = document.createElement("script");
    article.type = "application/ld+json";
    article.id = "blog-post-jsonld";
    article.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: post.title,
      description: post.excerpt || undefined,
      image: post.cover_image || undefined,
      datePublished: post.published_at || undefined,
      dateModified: post.published_at || undefined,
      author: {
        "@type": "Person",
        name: "Coach Claire Rayners",
        description: "AI running coach persona at Scarpers, reviewed by the Scarpers editorial team.",
        url: "https://www.scarpers.co.uk/coach/claire-rayners",
      },
      publisher: { "@type": "Organization", name: "Scarpers", logo: { "@type": "ImageObject", url: "https://www.scarpers.co.uk/og-image.png" } },
      mainEntityOfPage: { "@type": "WebPage", "@id": `https://www.scarpers.co.uk/blog/${post.slug}` },
    });
    document.head.appendChild(article);

    const crumbs = document.createElement("script");
    crumbs.type = "application/ld+json";
    crumbs.id = "blog-post-breadcrumbs-jsonld";
    crumbs.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://www.scarpers.co.uk/" },
        { "@type": "ListItem", position: 2, name: "Blog", item: "https://www.scarpers.co.uk/blog" },
        { "@type": "ListItem", position: 3, name: post.title, item: `https://www.scarpers.co.uk/blog/${post.slug}` },
      ],
    });
    document.head.appendChild(crumbs);

    return () => { article.remove(); crumbs.remove(); };
  }, [post]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (notFound || !post) {
    return (
      <MarketingPageLayout title="Post not found | Scarpers" description="This blog post doesn't exist or isn't published yet." canonicalPath={`/blog/${slug ?? ""}`} noindex>
        <div className="text-center py-20">
          <h1 className="text-2xl font-bold mb-2">Post Not Found</h1>
          <p className="text-muted-foreground mb-6 text-sm">This post doesn't exist or isn't published yet.</p>
          <Link to="/blog" className="text-primary text-sm hover:underline">← Back to Blog</Link>
        </div>
      </MarketingPageLayout>
    );
  }

  return (
    <MarketingPageLayout
      title={`${post.title} | Scarpers Blog`}
      description={post.excerpt || `${post.title} — Scarpers running blog.`}
      canonicalPath={`/blog/${post.slug}`}
    >
      <div className="flex items-center justify-between mb-6">
        <Link to="/blog" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> All posts
        </Link>
        {isAdmin && (
          <Link
            to={`/admin/blog?edit=${post.id}`}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <Pencil className="h-4 w-4" /> Edit post
          </Link>
        )}
      </div>

      {isPreview && (
        <div className="rounded-xl bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 px-4 py-2 text-sm text-amber-800 dark:text-amber-200 font-medium mb-6">
          ⚠️ Preview Mode — This post is not published yet
        </div>
      )}

      <article>
        {post.cover_image && (
          <img src={post.cover_image} alt={post.title} className="w-full h-56 md:h-80 object-cover rounded-2xl mb-8" />
        )}

        <h1 className="text-3xl md:text-5xl font-bold text-foreground leading-tight tracking-tight" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
          {post.title}
        </h1>

        {post.published_at && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-4 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              {new Date(post.published_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              By <Link to="/coach/claire-rayners" className="text-foreground hover:underline">Coach Claire Rayners</Link>, reviewed by the Scarpers team
            </span>
          </div>
        )}

        <div className="blog-content mt-8 text-foreground" dangerouslySetInnerHTML={{ __html: renderContent(post.content) }} />
      </article>

      <BlogInteractions postId={post.id} postTitle={post.title} postSlug={post.slug} />
    </MarketingPageLayout>
  );
};

export default BlogPost;

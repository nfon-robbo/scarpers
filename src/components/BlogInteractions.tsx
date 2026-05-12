import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Heart, Share2, MessageCircle, Trash2, Facebook, Link2, Loader2, Printer } from "lucide-react";

const XLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M18.244 2H21.5l-7.5 8.57L22.5 22h-6.91l-5.41-7.07L3.9 22H.64l8.02-9.17L.5 2h7.09l4.89 6.46L18.244 2Zm-1.21 18h1.86L7.06 4H5.1l11.93 16Z"/>
  </svg>
);
import { toast } from "sonner";

interface Props {
  postId: string;
  postTitle: string;
  postSlug: string;
}

interface Comment {
  id: string;
  user_id: string;
  author_name: string;
  content: string;
  created_at: string;
}

const BlogInteractions = ({ postId, postTitle, postSlug }: Props) => {
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [hasLiked, setHasLiked] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [commentText, setCommentText] = useState("");
  const [commentName, setCommentName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!active) return;
      const uid = session?.user.id ?? null;
      setUserId(uid);
      if (uid) {
        const { data: adminFlag } = await supabase.rpc("has_role", { _user_id: uid, _role: "admin" });
        if (active) setIsAdmin(!!adminFlag);
        const meta = (session?.user.user_metadata ?? {}) as Record<string, string>;
        setCommentName(meta.full_name || meta.name || session?.user.email?.split("@")[0] || "");
      }
      await Promise.all([loadLikes(uid), loadComments()]);
    };
    init();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  const loadLikes = async (uid: string | null) => {
    const { count } = await supabase
      .from("blog_likes")
      .select("id", { count: "exact", head: true })
      .eq("post_id", postId);
    setLikeCount(count || 0);
    if (uid) {
      const { data } = await supabase
        .from("blog_likes")
        .select("id")
        .eq("post_id", postId)
        .eq("user_id", uid)
        .maybeSingle();
      setHasLiked(!!data);
    } else {
      setHasLiked(false);
    }
  };

  const loadComments = async () => {
    setLoadingComments(true);
    const { data } = await supabase
      .from("blog_comments")
      .select("*")
      .eq("post_id", postId)
      .order("created_at", { ascending: false });
    setComments((data as Comment[]) || []);
    setLoadingComments(false);
  };

  const toggleLike = async () => {
    if (!userId) { toast.info("Sign in to like this post"); return; }
    setLikeBusy(true);
    if (hasLiked) {
      await supabase.from("blog_likes").delete().eq("post_id", postId).eq("user_id", userId);
      setHasLiked(false);
      setLikeCount((c) => Math.max(0, c - 1));
    } else {
      const { error } = await supabase.from("blog_likes").insert({ post_id: postId, user_id: userId });
      if (!error) {
        setHasLiked(true);
        setLikeCount((c) => c + 1);
      }
    }
    setLikeBusy(false);
  };

  const share = async (platform: "copy" | "twitter" | "facebook") => {
    const url = `${window.location.origin}/blog/${postSlug}`;
    if (platform === "copy") {
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied");
      } catch {
        toast.error("Couldn't copy link");
      }
      return;
    }
    const text = encodeURIComponent(postTitle);
    const encoded = encodeURIComponent(url);
    const target = platform === "twitter"
      ? `https://twitter.com/intent/tweet?text=${text}&url=${encoded}`
      : `https://www.facebook.com/sharer/sharer.php?u=${encoded}`;
    window.open(target, "_blank", "noopener,noreferrer,width=600,height=500");
  };

  const submitComment = async () => {
    if (!userId) { toast.info("Sign in to comment"); return; }
    const trimmed = commentText.trim();
    const name = commentName.trim();
    if (!name) { toast.error("Add a display name"); return; }
    if (trimmed.length < 2) { toast.error("Comment is too short"); return; }
    if (trimmed.length > 2000) { toast.error("Comment is too long (max 2000)"); return; }
    setSubmitting(true);
    const { error } = await supabase
      .from("blog_comments")
      .insert({ post_id: postId, user_id: userId, author_name: name.slice(0, 80), content: trimmed });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    setCommentText("");
    toast.success("Comment posted");
    loadComments();
  };

  const deleteComment = async (id: string) => {
    if (!confirm("Delete this comment?")) return;
    const { error } = await supabase.from("blog_comments").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Comment deleted");
    loadComments();
  };

  return (
    <section className="mt-12 border-t border-border/60 pt-8">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={hasLiked ? "default" : "outline"}
          size="sm"
          onClick={toggleLike}
          disabled={likeBusy}
          className="gap-2 rounded-full"
        >
          <Heart className={`h-4 w-4 ${hasLiked ? "fill-current" : ""}`} />
          {likeCount} {likeCount === 1 ? "like" : "likes"}
        </Button>

        <div className="flex items-center gap-1 ml-auto">
          <span className="text-xs text-muted-foreground mr-1 inline-flex items-center gap-1">
            <Share2 className="h-3.5 w-3.5" /> Share
          </span>
          <Button type="button" variant="ghost" size="icon" onClick={() => share("copy")} aria-label="Copy link">
            <Link2 className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={() => share("twitter")} aria-label="Share on Twitter">
            <Twitter className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={() => share("facebook")} aria-label="Share on Facebook">
            <Facebook className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-10">
        <h2 className="text-2xl font-bold flex items-center gap-2" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
          <MessageCircle className="h-5 w-5" /> Comments ({comments.length})
        </h2>

        {userId ? (
          <div className="mt-4 space-y-3">
            <Input
              value={commentName}
              onChange={(e) => setCommentName(e.target.value)}
              placeholder="Your name"
              maxLength={80}
            />
            <Textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Share your thoughts…"
              rows={3}
              maxLength={2000}
            />
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">{commentText.length}/2000</span>
              <Button type="button" onClick={submitComment} disabled={submitting} size="sm">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Post comment"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            <Link to="/auth" className="text-primary hover:underline">Sign in</Link> to leave a comment.
          </p>
        )}

        <div className="mt-8 space-y-4">
          {loadingComments ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : comments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Be the first to comment.</p>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="rounded-xl bg-card/60 border border-border/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{c.author_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(c.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </p>
                  </div>
                  {(userId === c.user_id || isAdmin) && (
                    <Button type="button" variant="ghost" size="icon" onClick={() => deleteComment(c.id)} aria-label="Delete comment">
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  )}
                </div>
                <p className="mt-2 text-sm text-foreground whitespace-pre-wrap">{c.content}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
};

export default BlogInteractions;

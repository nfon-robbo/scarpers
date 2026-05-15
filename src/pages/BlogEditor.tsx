import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Plus, Pencil, Trash2, Eye, Loader2, Sparkles } from "lucide-react";
import RichTextEditor from "@/components/RichTextEditor";

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  cover_image: string | null;
  published: boolean;
  published_at: string | null;
  created_at: string;
}

const BlogEditor = () => {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<BlogPost | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [generatingExcerpt, setGeneratingExcerpt] = useState(false);
  const [generatingTitle, setGeneratingTitle] = useState(false);
  const [generatingSlug, setGeneratingSlug] = useState(false);
  const [titleSuggestions, setTitleSuggestions] = useState<string[]>([]);

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [content, setContent] = useState("");
  const [coverImage, setCoverImage] = useState("");
  const [imagePrompt, setImagePrompt] = useState("");
  const [published, setPublished] = useState(false);
  // Local datetime-input string ("YYYY-MM-DDTHH:mm"); empty = publish immediately when toggled on
  const [scheduledFor, setScheduledFor] = useState("");

  // Convert ISO -> value for <input type="datetime-local"> in user's local TZ
  const isoToLocalInput = (iso: string | null | undefined) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  useEffect(() => { checkAdminAndLoad(); }, []);

  const checkAdminAndLoad = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { navigate("/auth"); return; }
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: session.user.id, _role: "admin" });
    if (!isAdmin) { navigate("/dashboard"); return; }
    loadPosts();
  };

  const loadPosts = async () => {
    setLoading(true);
    const { data } = await supabase.from("blog_posts").select("*").order("created_at", { ascending: false });
    const list = (data as BlogPost[]) || [];
    setPosts(list);
    setLoading(false);

    const editId = new URLSearchParams(window.location.search).get("edit");
    if (editId) {
      const found = list.find((p) => p.id === editId);
      if (found) openEdit(found);
    }
  };

  const slugify = (text: string) =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const openNew = () => {
    setIsNew(true); setEditing(null);
    setTitle(""); setSlug(""); setExcerpt(""); setContent(""); setCoverImage("");
    setPublished(false); setGeneratedImages([]); setImagePrompt(""); setScheduledFor("");
  };

  const openEdit = (post: BlogPost) => {
    setIsNew(false); setEditing(post);
    setTitle(post.title); setSlug(post.slug); setExcerpt(post.excerpt || "");
    setContent(post.content); setCoverImage(post.cover_image || "");
    setPublished(post.published); setGeneratedImages([]); setImagePrompt("");
    // Pre-fill schedule input if the post is scheduled for the future
    const futurePub = post.published_at && new Date(post.published_at).getTime() > Date.now();
    setScheduledFor(futurePub ? isoToLocalInput(post.published_at) : "");
  };

  const closeEditor = () => { setEditing(null); setIsNew(false); };

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) { toast.error("Title and content are required"); return; }
    const finalSlug = slug.trim() || slugify(title);

    // Resolve schedule -> published_at
    let resolvedPublished = published;
    let resolvedPublishedAt: string | null = null;
    if (scheduledFor) {
      const d = new Date(scheduledFor);
      if (isNaN(d.getTime())) { toast.error("Invalid scheduled date/time"); return; }
      // Scheduling implies the post should go live automatically — flag as published with a future date
      resolvedPublished = true;
      resolvedPublishedAt = d.toISOString();
    } else if (published) {
      resolvedPublishedAt = editing?.published_at || new Date().toISOString();
    }

    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const payload = {
      title: title.trim(),
      slug: finalSlug,
      excerpt: excerpt.trim() || null,
      content: content.trim(),
      cover_image: coverImage.trim() || null,
      published: resolvedPublished,
      published_at: resolvedPublishedAt,
      updated_at: new Date().toISOString(),
    };

    const isScheduled = !!scheduledFor && resolvedPublishedAt && new Date(resolvedPublishedAt).getTime() > Date.now();

    if (isNew) {
      const { error } = await supabase.from("blog_posts").insert({ ...payload, author_id: session.user.id });
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success(isScheduled ? `Scheduled for ${new Date(resolvedPublishedAt!).toLocaleString("en-GB")}` : "Post created");
    } else if (editing) {
      const { error } = await supabase.from("blog_posts").update(payload).eq("id", editing.id);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success(isScheduled ? `Scheduled for ${new Date(resolvedPublishedAt!).toLocaleString("en-GB")}` : "Post updated");
    }
    setSaving(false);
    closeEditor();
    loadPosts();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this post?")) return;
    await supabase.from("blog_posts").delete().eq("id", id);
    toast.success("Post deleted");
    loadPosts();
  };


  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (isNew || editing) {
    return (
      <div className="min-h-screen bg-background px-4 py-8 max-w-3xl mx-auto">
        <button onClick={closeEditor} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="h-4 w-4" /> Back to posts
        </button>
        <h1 className="text-2xl font-bold text-foreground mb-6" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
          {isNew ? "New Blog Post" : "Edit Post"}
        </h1>

        <div className="space-y-5">
          <div>
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(e) => { setTitle(e.target.value); if (isNew) setSlug(slugify(e.target.value)); }}
              placeholder="Your blog post title"
              className="mt-1"
            />
            <div className="mt-2">
              <Button type="button" variant="outline" size="sm" className="rounded-xl gap-1.5"
                disabled={generatingTitle || !content.trim()}
                onClick={async () => {
                  setGeneratingTitle(true);
                  try {
                    const { data, error } = await supabase.functions.invoke("generate-blog-meta", {
                      body: { type: "title", content: content.trim() },
                    });
                    if (error) throw error;
                    if (data?.error) { toast.error(data.error); return; }
                    if (data?.titles?.length) { setTitleSuggestions(data.titles); toast.success("Title suggestions ready"); }
                  } catch (err: any) { toast.error(err.message || "Failed to generate titles"); }
                  finally { setGeneratingTitle(false); }
                }}
              >
                {generatingTitle ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {generatingTitle ? "Generating…" : "Generate AI Title"}
              </Button>
              {!content.trim() && <p className="text-[10px] text-muted-foreground mt-1">Add content first so AI can read it</p>}
            </div>
            {titleSuggestions.length > 0 && (
              <div className="mt-2 space-y-1">
                {titleSuggestions.map((t, i) => (
                  <button key={i} type="button"
                    onClick={() => { setTitle(t); if (isNew) setSlug(slugify(t)); setTitleSuggestions([]); toast.success("Title selected"); }}
                    className="w-full text-left text-sm px-3 py-2 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors"
                  >{t}</button>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label>Slug</Label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="url-friendly-slug" className="mt-1" />
            <div className="mt-2">
              <Button type="button" variant="outline" size="sm" className="rounded-xl gap-1.5"
                disabled={generatingSlug || (!title.trim() && !content.trim())}
                onClick={async () => {
                  setGeneratingSlug(true);
                  try {
                    const { data, error } = await supabase.functions.invoke("generate-blog-meta", {
                      body: { type: "slug", title: title.trim(), content: content.trim() },
                    });
                    if (error) throw error;
                    if (data?.error) { toast.error(data.error); return; }
                    if (data?.slug) { setSlug(data.slug); toast.success("SEO slug generated"); }
                  } catch (err: any) { toast.error(err.message || "Failed to generate slug"); }
                  finally { setGeneratingSlug(false); }
                }}
              >
                {generatingSlug ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {generatingSlug ? "Generating…" : "Generate SEO Slug"}
              </Button>
            </div>
          </div>

          <div>
            <Label>Excerpt</Label>
            <Textarea value={excerpt} onChange={(e) => setExcerpt(e.target.value)} placeholder="Short summary for the listing page…" rows={2} className="mt-1" />
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Button type="button" variant="outline" size="sm" className="rounded-xl gap-2"
                disabled={generatingExcerpt || !title.trim() || !content.trim()}
                onClick={async () => {
                  setGeneratingExcerpt(true);
                  try {
                    const { data, error } = await supabase.functions.invoke("generate-blog-excerpt", {
                      body: { title: title.trim(), content: content.trim() },
                    });
                    if (error) throw error;
                    if (data?.error) toast.error(data.error);
                    else if (data?.excerpt) { setExcerpt(data.excerpt); toast.success("SEO excerpt generated"); }
                  } catch (err: any) { toast.error(err.message || "Failed to generate excerpt"); }
                  finally { setGeneratingExcerpt(false); }
                }}
              >
                {generatingExcerpt ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {generatingExcerpt ? "Generating…" : "Generate SEO Excerpt"}
              </Button>
              {excerpt && (
                <span className={`text-xs ${excerpt.length >= 120 && excerpt.length <= 155 ? "text-primary" : "text-amber-600"}`}>
                  {excerpt.length} chars {excerpt.length >= 120 && excerpt.length <= 155 ? "✓ ideal" : "(aim for 120-155)"}
                </span>
              )}
            </div>
          </div>

          <div>
            <Label>Cover Image</Label>
            <div className="mt-1 space-y-2">
              <Input type="file" accept="image/*"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setUploadingImage(true);
                  const ext = file.name.split(".").pop();
                  const path = `${Date.now()}.${ext}`;
                  const { error } = await supabase.storage.from("blog-images").upload(path, file, { upsert: true });
                  if (error) { toast.error("Upload failed: " + error.message); setUploadingImage(false); return; }
                  const { data: urlData } = supabase.storage.from("blog-images").getPublicUrl(path);
                  setCoverImage(urlData.publicUrl);
                  setUploadingImage(false);
                  toast.success("Image uploaded");
                }}
                className="cursor-pointer"
              />
              <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
                <Label className="text-xs font-medium">Custom AI prompt (optional)</Label>
                <Textarea value={imagePrompt} onChange={(e) => setImagePrompt(e.target.value)}
                  placeholder="e.g. A close-up of running shoes on a misty trail at sunrise, shallow depth of field"
                  rows={2} className="text-sm" />
                <p className="text-[10px] text-muted-foreground">Leave blank to generate from the title. Add a prompt to control exactly what the cover shows.</p>
                <Button type="button" variant="outline" className="rounded-xl gap-2"
                  disabled={generatingImage || (!title.trim() && !imagePrompt.trim())}
                  onClick={async () => {
                    setGeneratingImage(true);
                    try {
                      const { data, error } = await supabase.functions.invoke("generate-blog-cover", {
                        body: { title: title.trim(), customPrompt: imagePrompt.trim() || undefined },
                      });
                      if (error) {
                        const errMsg = typeof error === "object" && (error as any).message ? (error as any).message : String(error);
                        throw new Error(errMsg);
                      }
                      if (data?.error) toast.error(data.error);
                      else if (data?.url) {
                        setGeneratedImages((prev) => [...prev, data.url]);
                        setCoverImage(data.url);
                        toast.success("AI cover image generated");
                      }
                    } catch (err: any) { toast.error(err.message || "Failed to generate image"); }
                    finally { setGeneratingImage(false); }
                  }}
                >
                  {generatingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {generatingImage ? "Generating…" : generatedImages.length > 0 ? "Generate Another" : "Generate AI Cover"}
                </Button>
              </div>
              {uploadingImage && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</div>}
              {generatedImages.length > 1 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Click an image to select it as your cover:</p>
                  <div className="grid grid-cols-3 gap-2">
                    {generatedImages.map((url, i) => (
                      <button key={i} type="button" onClick={() => setCoverImage(url)}
                        className={`relative rounded-lg overflow-hidden border-2 transition-all ${coverImage === url ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-muted-foreground"}`}>
                        <img src={url} alt={`Option ${i + 1}`} className="h-24 w-full object-cover" />
                        {coverImage === url && (
                          <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
                            <span className="bg-primary text-primary-foreground text-xs font-medium px-2 py-0.5 rounded-full">Selected</span>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {coverImage && <img src={coverImage} alt="Preview" className="rounded-xl h-40 w-full object-cover" />}
            </div>
          </div>

          <div>
            <Label>Content</Label>
            <div className="mt-1">
              <RichTextEditor content={content} onChange={setContent} />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Switch checked={published} onCheckedChange={setPublished} />
            <Label>Published</Label>
          </div>

          <div className="flex gap-3 pt-4">
            <Button onClick={handleSave} disabled={saving} className="rounded-xl">
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {isNew ? "Create Post" : "Save Changes"}
            </Button>
            <Button variant="outline" onClick={closeEditor} className="rounded-xl">Cancel</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8 max-w-3xl mx-auto">
      <button onClick={() => navigate("/dashboard")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </button>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>Blog Posts</h1>
        <Button onClick={openNew} className="rounded-xl gap-2"><Plus className="h-4 w-4" /> New Post</Button>
      </div>

      {posts.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground"><p className="text-sm">No blog posts yet. Create your first one!</p></div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <div key={post.id} className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
              {post.cover_image && <img src={post.cover_image} alt="" className="h-16 w-24 rounded-lg object-cover shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{post.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {post.published ? <span className="text-primary font-medium">Published</span> : <span className="text-amber-600">Draft</span>}
                  {" · "}
                  {new Date(post.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button variant="ghost" size="icon" onClick={() => window.open(`/blog/${post.slug}?preview=true`, "_blank")}><Eye className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => openEdit(post)}><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(post.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default BlogEditor;

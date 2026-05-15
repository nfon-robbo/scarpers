DROP POLICY IF EXISTS "Anyone can read published posts" ON public.blog_posts;
CREATE POLICY "Anyone can read published posts"
ON public.blog_posts
FOR SELECT
TO public
USING (published = true AND (published_at IS NULL OR published_at <= now()));
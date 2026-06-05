UPDATE public.blog_posts
SET content = replace(content, 'https://www.scarpers.co.uk/blog-images/ai-running-coach-hero.jpg', cover_image)
WHERE slug = 'what-is-an-ai-running-coach' AND cover_image IS NOT NULL;
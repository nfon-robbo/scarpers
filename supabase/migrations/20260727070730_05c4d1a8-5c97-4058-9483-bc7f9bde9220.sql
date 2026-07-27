DROP TRIGGER IF EXISTS enforce_blog_comment_author_name_trg ON public.blog_comments;
CREATE TRIGGER enforce_blog_comment_author_name_trg
BEFORE INSERT OR UPDATE ON public.blog_comments
FOR EACH ROW EXECUTE FUNCTION public.enforce_blog_comment_author_name();
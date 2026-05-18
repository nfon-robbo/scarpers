
-- 1. Restrict app_settings SELECT to admins
DROP POLICY IF EXISTS "Authenticated can read settings" ON public.app_settings;
CREATE POLICY "Admins can read settings"
ON public.app_settings
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 2. Server-side enforcement of blog_comments.author_name
CREATE OR REPLACE FUNCTION public.enforce_blog_comment_author_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_name text;
  email_name text;
BEGIN
  -- Always overwrite author_name with the authenticated user's profile name
  SELECT name INTO profile_name FROM public.profiles WHERE user_id = NEW.user_id LIMIT 1;

  IF profile_name IS NULL OR length(trim(profile_name)) = 0 THEN
    SELECT split_part(email, '@', 1) INTO email_name FROM auth.users WHERE id = NEW.user_id LIMIT 1;
    profile_name := COALESCE(NULLIF(trim(email_name), ''), 'Runner');
  END IF;

  NEW.author_name := left(profile_name, 80);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_blog_comment_author_name_trg ON public.blog_comments;
CREATE TRIGGER enforce_blog_comment_author_name_trg
BEFORE INSERT OR UPDATE ON public.blog_comments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_blog_comment_author_name();

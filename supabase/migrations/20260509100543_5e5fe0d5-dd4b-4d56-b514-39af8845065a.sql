CREATE OR REPLACE FUNCTION public.get_user_emails()
RETURNS TABLE(email text, created_at timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY SELECT u.email::text, u.created_at FROM auth.users u ORDER BY u.created_at DESC;
END;
$$;
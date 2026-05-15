
CREATE TABLE public.ga4_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_token text NOT NULL,
  access_token text,
  expires_at bigint,
  property_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.ga4_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage ga4 tokens" ON public.ga4_tokens
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER ga4_tokens_updated_at BEFORE UPDATE ON public.ga4_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

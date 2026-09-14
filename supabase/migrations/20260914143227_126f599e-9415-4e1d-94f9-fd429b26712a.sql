CREATE TABLE public.apple_health_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  token_hint text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  last_payload_summary text,
  revoked_at timestamptz
);

CREATE INDEX idx_apple_health_tokens_user ON public.apple_health_tokens(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.apple_health_tokens TO authenticated;
GRANT ALL ON public.apple_health_tokens TO service_role;

ALTER TABLE public.apple_health_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own Apple Health tokens"
ON public.apple_health_tokens FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
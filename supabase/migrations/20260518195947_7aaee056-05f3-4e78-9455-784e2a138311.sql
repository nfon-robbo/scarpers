-- Document service-role-only intent for oauth_state. RLS is already enabled.
-- Add an explicit deny-all policy for client roles so future policy additions are deliberate.
DROP POLICY IF EXISTS "oauth_state service role only" ON public.oauth_state;
CREATE POLICY "oauth_state service role only"
ON public.oauth_state
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);
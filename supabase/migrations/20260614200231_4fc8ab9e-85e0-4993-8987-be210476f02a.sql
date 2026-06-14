-- Restrict realtime channel topic subscriptions so a user can only
-- subscribe to their own notifications channel.

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can subscribe to own notifications channel" ON realtime.messages;
CREATE POLICY "Users can subscribe to own notifications channel"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.topic() = 'notifications:' || auth.uid()::text
);

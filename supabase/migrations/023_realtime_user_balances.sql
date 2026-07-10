-- Enable Supabase Realtime for user_balances so clients receive live
-- INSERT/UPDATE events (e.g. admin balance top-ups) without a re-login.
-- Guarded so re-running the migration is safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_balances'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE user_balances;
  END IF;
END
$$;

-- Enforce uniqueness of (user_id, source_file) on activities at the DB level.
-- Client-side guard in Upload.tsx only covers the manual upload path; this
-- makes it impossible for auto-sync, edge functions, or future write paths to
-- create duplicate activity rows for the same source file.
--
-- Partial index because source_file is nullable and NULLs are legitimately
-- distinct (e.g. android/live-recorded activities may have no source_file yet).
CREATE UNIQUE INDEX IF NOT EXISTS activities_user_source_file_unique
  ON public.activities (user_id, source_file)
  WHERE source_file IS NOT NULL;
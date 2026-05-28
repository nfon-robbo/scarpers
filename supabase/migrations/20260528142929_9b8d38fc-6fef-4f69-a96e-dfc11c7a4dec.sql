DROP INDEX IF EXISTS public.activities_source_file_unique;
CREATE UNIQUE INDEX activities_user_source_file_unique
  ON public.activities (user_id, source_file)
  WHERE source_file IS NOT NULL;
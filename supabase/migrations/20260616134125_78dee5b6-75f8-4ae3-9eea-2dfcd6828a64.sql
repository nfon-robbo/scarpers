UPDATE public.training_plans
SET content = REPLACE(
  REPLACE(content, 'Wednesday 20/05/2026', 'Thursday 21/05/2026'),
  'Monday 18/05/2026', 'Wednesday 20/05/2026'
)
WHERE id = '03acc823-ea35-4d23-8554-1851baf941f0';
UPDATE public.training_plans
SET content = replace(
  content,
  '### **Wednesday 20/05/2026** — Threshold Introduction (Total: 41min)',
  '### **Wednesday 20/05/2026** — 4x3min Threshold + 4x2min Steady, 1min Walk Recoveries (Total: 38min)'
)
WHERE id = '5f0faaf7-612c-4247-a01d-518081377d80';
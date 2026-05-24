
UPDATE public.blog_posts SET title='Personalised AI Running Plan: Ultimate Guide' WHERE slug='ultimate-guide-personalised-running-plan';
UPDATE public.blog_posts SET title='How to Start a 10K Training Plan' WHERE slug='how-to-start-10k-training-plan';
UPDATE public.blog_posts SET title='Speed Training & Running Economy Guide' WHERE slug='the-runner-s-guide-to-speed-training-and-running-economy';
UPDATE public.blog_posts SET title='What is an AI Running Coach? UK Guide' WHERE slug='what-is-an-ai-running-coach';
UPDATE public.blog_posts SET title='Generic Apps vs Personalised Training Plans' WHERE slug='generic-running-apps-vs-a-personalised-training-plan-which-is-better';
UPDATE public.blog_posts SET title='How to Run a 5K in 30 Minutes' WHERE slug='run-5k-30-minutes-guide';

UPDATE public.blog_posts
SET content = replace(content, 'href="www.scarpers.co.uk"', 'href="https://www.scarpers.co.uk/"')
WHERE slug='the-runner-s-guide-to-speed-training-and-running-economy';

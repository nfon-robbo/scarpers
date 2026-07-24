CREATE POLICY "Users can insert their own nutrition summary"
ON public.daily_nutrition_summary
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own nutrition summary"
ON public.daily_nutrition_summary
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
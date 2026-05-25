UPDATE public.daily_metrics
SET
  spo2_avg = COALESCE(spo2_avg, NULLIF((raw_data->'garmin_sleep_vitals'->>'avg_spo2'),'')::numeric),
  spo2_lowest = COALESCE(spo2_lowest, NULLIF((raw_data->'garmin_sleep_vitals'->>'lowest_spo2'),'')::numeric),
  respiration_avg = COALESCE(respiration_avg, NULLIF((raw_data->'garmin_sleep_vitals'->>'avg_respiration'),'')::numeric),
  breathing_pattern = COALESCE(breathing_pattern, NULLIF(raw_data->'garmin_sleep_vitals'->>'breathing_variations','')),
  skin_temp_deviation = COALESCE(skin_temp_deviation, NULLIF((raw_data->'garmin_sleep_vitals'->>'skin_temp_change_c'),'')::numeric),
  restless_count = COALESCE(restless_count, NULLIF((raw_data->'garmin_sleep_vitals'->>'restless_moments'),'')::integer),
  hrv_7d_trend = COALESCE(hrv_7d_trend, NULLIF(raw_data->'garmin_sleep_vitals'->>'hrv_7d_status','')),
  body_battery_change = COALESCE(body_battery_change, NULLIF((raw_data->'garmin_sleep_vitals'->>'body_battery_change'),'')::integer)
WHERE raw_data ? 'garmin_sleep_vitals';
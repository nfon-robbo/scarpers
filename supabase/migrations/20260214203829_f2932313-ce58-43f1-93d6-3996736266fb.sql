ALTER TABLE public.profiles
ADD COLUMN unit_distance text NOT NULL DEFAULT 'km',
ADD COLUMN unit_speed text NOT NULL DEFAULT 'km/h',
ADD COLUMN unit_elevation text NOT NULL DEFAULT 'm',
ADD COLUMN unit_temperature text NOT NULL DEFAULT 'C',
ADD COLUMN unit_weight text NOT NULL DEFAULT 'kg';
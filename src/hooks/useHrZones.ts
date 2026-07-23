import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  resolveZones,
  OBSERVED_MAX_LOOKBACK_DAYS,
  type Zones,
} from "@shared/hr-zones";

/**
 * Resolve the current user's HR zones once and share across surfaces.
 *
 * Priority (delegated to `resolveZones`):
 *   1. Measured LTHR from a benchmark (step 3 will populate this — currently null)
 *   2. Corroborated observed max HR from the last 180 days → 89% for estimated LTHR
 *   3. 220 − age → 89% for estimated LTHR
 *   4. Hard fallback max 190
 *
 * Consumers: Analytics chart, ActivityDetailDialog per-activity breakdown.
 * The Deno edge functions (`ai-coach`, `intervals-sync`) call `resolveZones`
 * directly with server-side queries; no HTTP round-trip through this hook.
 */
export function useHrZones(): { zones: Zones | null; loading: boolean } {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zones | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setZones(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const sinceIso = new Date(
        Date.now() - OBSERVED_MAX_LOOKBACK_DAYS * 86400 * 1000,
      ).toISOString();
      const [{ data: profile }, { data: acts }] = await Promise.all([
        supabase
          .from("profiles")
          .select("date_of_birth")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("activities")
          .select("id, max_heart_rate, start_time, activity_type")
          .eq("user_id", user.id)
          .gte("start_time", sinceIso)
          .not("max_heart_rate", "is", null),
      ]);
      if (cancelled) return;
      const dob = (profile as { date_of_birth?: string } | null)?.date_of_birth;
      const ageYears = dob
        ? (Date.now() - new Date(dob).getTime()) / (365.25 * 86400 * 1000)
        : null;
      setZones(resolveZones({ ageYears, activities: acts ?? [] }));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return { zones, loading };
}

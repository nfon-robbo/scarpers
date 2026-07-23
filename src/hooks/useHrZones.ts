import { useQuery } from "@tanstack/react-query";
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
 * Cached via react-query under key ["hr-zones", userId]; multiple mounts on
 * the same page (Analytics + ActivityDetailDialog etc.) share one fetch.
 * staleTime = 30 min — zones only shift when a new corroborated max lands.
 */
export function useHrZones(): { zones: Zones | null; loading: boolean } {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["hr-zones", user?.id ?? null],
    enabled: !!user,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    queryFn: async (): Promise<Zones> => {
      const sinceIso = new Date(
        Date.now() - OBSERVED_MAX_LOOKBACK_DAYS * 86400 * 1000,
      ).toISOString();
      const [{ data: profile }, { data: acts }] = await Promise.all([
        supabase
          .from("profiles")
          .select("date_of_birth")
          .eq("user_id", user!.id)
          .maybeSingle(),
        supabase
          .from("activities")
          .select("id, max_heart_rate, start_time, activity_type")
          .eq("user_id", user!.id)
          .gte("start_time", sinceIso)
          .not("max_heart_rate", "is", null),
      ]);
      const dob = (profile as { date_of_birth?: string } | null)?.date_of_birth;
      const ageYears = dob
        ? (Date.now() - new Date(dob).getTime()) / (365.25 * 86400 * 1000)
        : null;
      return resolveZones({ ageYears, activities: acts ?? [] });
    },
  });
  return { zones: q.data ?? null, loading: q.isLoading };
}


import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { resolveZonesForUser, type Zones } from "@shared/hr-zones";

/**
 * Resolve the current user's HR zones once and share across surfaces.
 *
 * Delegates to the canonical `resolveZonesForUser` helper so this hook,
 * the ai-coach edge function, and intervals-sync all see identical zones
 * for a given user. Never pass your own activity slice — the canonical
 * 180-day window is baked into the shared resolver.
 *
 * Reads the latest active-confirmed benchmark's LTHR and passes it into
 * the resolver as `measuredLthr` so measured zones win over observed-max
 * estimates once a benchmark has been confirmed.
 *
 * Cached via react-query under key ["hr-zones", userId]; multiple mounts on
 * the same page share one fetch. staleTime = 30 min — zones only shift when
 * a new corroborated max lands or a new benchmark is confirmed.
 */
export function useHrZones(): { zones: Zones | null; loading: boolean } {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["hr-zones", user?.id ?? null],
    enabled: !!user,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    queryFn: async () => {
      const { data: bench } = await supabase
        .from("benchmark_results" as any)
        .select("lthr")
        .eq("user_id", user!.id)
        .eq("status", "confirmed")
        .eq("active", true)
        .not("lthr", "is", null)
        .order("benchmark_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      const measuredLthr = (bench as any)?.lthr ?? null;
      return resolveZonesForUser(supabase as any, user!.id, { measuredLthr });
    },
  });
  return { zones: q.data ?? null, loading: q.isLoading };
}




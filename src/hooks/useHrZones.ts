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
 * Cached via react-query under key ["hr-zones", userId]; multiple mounts on
 * the same page share one fetch. staleTime = 30 min — zones only shift when
 * a new corroborated max lands.
 */
export function useHrZones(): { zones: Zones | null; loading: boolean } {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["hr-zones", user?.id ?? null],
    enabled: !!user,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    queryFn: () => resolveZonesForUser(supabase as any, user!.id),
  });
  return { zones: q.data ?? null, loading: q.isLoading };
}



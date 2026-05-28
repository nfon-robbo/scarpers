import { Flag } from "lucide-react";
import { ParsedWorkout } from "@/lib/plan-export";

interface Props {
  raceDistance?: string;
  workouts: ParsedWorkout[];
}

// Pull "Z2 (113-131 bpm)" / "Z1 (<113 bpm)" style ranges from any workout in
// the plan so the strategy quotes the athlete's actual zones instead of
// generic numbers.
function extractZoneBpm(workouts: ParsedWorkout[]): Record<number, string> {
  const map: Record<number, string> = {};
  for (const w of workouts) {
    for (const s of w.segments || []) {
      const txt = `${s.hrZone || ""} ${s.target || ""} ${s.notes || ""}`;
      for (const m of txt.matchAll(/Z(\d)\s*\(([^)]*bpm[^)]*)\)/gi)) {
        const z = parseInt(m[1], 10);
        if (!map[z]) map[z] = m[2].trim();
      }
    }
  }
  return map;
}

function zRange(map: Record<number, string>, zones: number[], fallback: string): string {
  for (const z of zones) if (map[z]) return map[z];
  return fallback;
}

// km count for each supported race distance
function raceKm(d?: string): number {
  switch ((d || "").toLowerCase()) {
    case "5k": return 5;
    case "10k": return 10;
    case "half-marathon":
    case "half": return 21;
    case "marathon": return 42;
    default: return 10;
  }
}

function raceLabel(d?: string): string {
  switch ((d || "").toLowerCase()) {
    case "5k": return "5K";
    case "10k": return "10K";
    case "half-marathon":
    case "half": return "Half Marathon";
    case "marathon": return "Marathon";
    default: return "Race";
  }
}

export default function RaceStrategyBlock({ raceDistance, workouts }: Props) {
  const z = extractZoneBpm(workouts);
  const km = raceKm(raceDistance);
  const label = raceLabel(raceDistance);

  // Phase boundaries scaled to race distance (20% / 60% / 80%).
  const p1End = Math.max(1, Math.round(km * 0.2));
  const p2Start = p1End + 1;
  const p2End = Math.max(p2Start, Math.round(km * 0.6));
  const p3Start = p2End + 1;
  const p3End = Math.max(p3Start, Math.round(km * 0.8));
  const p4Start = p3End + 1;
  const trouble = Math.max(2, Math.round(km * 0.4));

  const z2z3 = zRange(z, [2, 3], "easy aerobic");
  const z3 = zRange(z, [3], "steady");
  const z3z4 = zRange(z, [3, 4], "controlled hard");

  const Item = ({ heading, body }: { heading: string; body: React.ReactNode }) => (
    <div className="space-y-0.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">{heading}</p>
      <p className="text-sm text-foreground/90 leading-relaxed">{body}</p>
    </div>
  );

  return (
    <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Flag className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-bold uppercase tracking-wide">Race Strategy — {label}</h3>
      </div>

      <Item
        heading={`Kilometres 1–${p1End}`}
        body={<>Hold back. It will feel too easy. That's correct. Target <strong>Z2–Z3 ({z2z3})</strong>. Do not chase other runners.</>}
      />
      <Item
        heading={`Kilometres ${p2Start}–${p2End}`}
        body={<>Settle into your rhythm. <strong>Z3 effort ({z3})</strong>. This is the engine room of the race. Stay smooth.</>}
      />
      <Item
        heading={`Kilometres ${p3Start}–${p3End}`}
        body={<>If you feel good, gradually increase effort to <strong>Z3–Z4 ({z3z4})</strong>. This is where the race is won or lost.</>}
      />
      <Item
        heading={`Kilometres ${p4Start}–${km}`}
        body={<>Empty the tank. Give everything you have left. You will not need it after the finish line.</>}
      />

      <div className="pt-2 border-t border-primary/20 space-y-2">
        <p className="text-xs text-muted-foreground leading-relaxed">
          <strong className="text-foreground">If you feel terrible at km {trouble}:</strong> slow down 15 seconds per km and hold that to the finish. Do not walk unless injured.
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Goal:</strong> cross the line knowing you left nothing on the course.
        </p>
      </div>
    </div>
  );
}

/**
 * User-added workout steps (warm-up / rep / cool-down / custom) that are
 * appended to the AI-generated step list. Stored in localStorage only —
 * the AI plan markdown and DB rows are never touched.
 *
 * Both the workout detail dialog and the Intervals.icu sync read from here,
 * so what the user sees is exactly what gets exported.
 */
import type { ExpandedStep } from "./plan-step-expand";
import { parseDurationSeconds, normalizePaceInput } from "./plan-step-expand";

export type CustomStepKind = "warmup" | "rep" | "cooldown" | "custom";

export interface CustomStep {
  id: string;
  kind: CustomStepKind;
  label: string;
  duration: string; // mm:ss or "10 min"
  pace?: string;    // m:ss/km — optional, omitted for warm/cool
}

const KEY = "plan-custom-steps";

export type CustomStepsMap = Record<string, CustomStep[]>;

export function loadCustomSteps(): CustomStepsMap {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveCustomSteps(map: CustomStepsMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {}
}

export function defaultsFor(kind: CustomStepKind): { label: string; duration: string; pace?: string } {
  switch (kind) {
    case "warmup":   return { label: "Warm-up", duration: "10:00" };
    case "cooldown": return { label: "Cool-down", duration: "10:00" };
    case "rep":      return { label: "Rep", duration: "01:00", pace: "5:00/km" };
    case "custom":   return { label: "Custom", duration: "05:00" };
  }
}

/** Convert custom steps into ExpandedStep so they slot into the same rendering / export pipeline. */
export function customToExpanded(steps: CustomStep[]): ExpandedStep[] {
  return steps.map((s) => {
    const duration = parseDurationSeconds(s.duration) || 600;
    const isWarm = s.kind === "warmup";
    const isCool = s.kind === "cooldown";
    if (isWarm || isCool) {
      return {
        duration,
        hrLow: isWarm ? 120 : 100,
        hrHigh: isWarm ? 140 : 120,
        hrZone: isWarm ? "Z2" : "Z1",
        intensity: isWarm ? "Warmup" : "Cooldown",
        pace: "13:00/km",
        label: s.label,
      };
    }
    const pace = s.pace ? normalizePaceInput(s.pace) : "";
    if (pace) {
      return {
        duration,
        hrLow: 140, hrHigh: 175, hrZone: "Z3-Z4",
        intensity: "Interval",
        pace,
        label: s.label,
      };
    }
    return {
      duration,
      hrLow: 120, hrHigh: 140, hrZone: "Z2",
      intensity: "Active",
      pace: "",
      label: s.label,
    };
  });
}

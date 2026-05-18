/**
 * Deterministic parser for chatbot workout recommendations.
 *
 * When a user clicks "✨ Apply suggested workout", we used to pipe the chat
 * recommendation through the `day-adjust` Edge Function — which would then
 * re-interpret it through the SURGICAL EDIT MODE rules and frequently keep
 * the original session type. This parser bypasses that round-trip by turning
 * the chatbot's reply directly into a structured `EditedWorkout` we can splice
 * into the plan.
 *
 * It tolerates the two shapes the chatbot currently emits:
 *
 *   A) Intervals.icu-style line list:
 *      "1. Warm Up Walk — 05:00 (mm:ss) — No pace"
 *      "3. Race Pace Block — 20:00 (mm:ss) — 6:00 Pace (min/km)"
 *
 *   B) Numbered/bulleted prose:
 *      "1. Warm-up • 5 min walk, 10 min easy jog • Z1-Z2 🎵 150-155 BPM; ..."
 *
 * And also markdown tables already in the plan format.
 */

import type { EditedSegment, EditedWorkout } from "@/lib/plan-day-actions";

const MOBILITY_RE =
  /\b(mobility|stretch(?:ing)?|foam[- ]?roll(?:ing)?|yoga|breath(?:ing)?\s*work)\b/i;

// ── helpers ────────────────────────────────────────────────────────────────
function cleanSegmentName(raw: string): string {
  return raw
    .replace(/^\d+\.\s*/, "")
    .replace(/^[•\-*]\s*/, "")
    .replace(/\s+$/, "")
    .trim();
}

function durationToMin(s: string): number | null {
  // "5 min", "05:00", "20:00", "1 hour", "1h 30m"
  const mmss = s.match(/(\d{1,2}):(\d{2})/);
  if (mmss) return Number(mmss[1]) + Number(mmss[2]) / 60;
  const min = s.match(/(\d+(?:\.\d+)?)\s*(?:min|m)\b/i);
  if (min) return Number(min[1]);
  const hr = s.match(/(\d+(?:\.\d+)?)\s*(?:hr?|hour)/i);
  if (hr) return Number(hr[1]) * 60;
  return null;
}

function normaliseDuration(s: string): string {
  // Prefer "Nmm min" if we can convert; preserve "mm:ss" otherwise.
  const min = durationToMin(s);
  if (min == null) return s.trim();
  if (Number.isInteger(min)) return `${min} min`;
  return `${min.toFixed(1).replace(/\.0$/, "")} min`;
}

function extractHrZone(text: string): string {
  // "Z1", "Z1-Z2", "Z4 (151-169 bpm)", "Z2 → Z1"
  const m = text.match(/Z[1-5](?:\s*[-–→]\s*Z[1-5])?/i);
  return m ? m[0].toUpperCase().replace(/\s+/g, "") : "";
}

function extractBpm(text: string): string {
  // "🎵 170 BPM", "150-155 BPM"
  const m = text.match(/🎵?\s*([\d\-– ]+?\s*BPM)/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

function extractPace(text: string): string {
  // "6:00/km", "5:30-5:45/km", "6:00 Pace (min/km)"
  const m =
    text.match(/(\d{1,2}:\d{2}(?:\s*[-–]\s*\d{1,2}:\d{2})?\s*\/?\s*km)/i) ||
    text.match(/(\d{1,2}:\d{2})\s*Pace/i);
  return m ? m[1].replace(/\s+/g, "") : "";
}

function extractTitle(text: string): string {
  // Prefer bold heading like "**Race Pace Dress Rehearsal (Total: 40min)**"
  const bold = text.match(/\*\*([^*\n]+?)\*\*/);
  if (bold) {
    const inner = bold[1].trim();
    // Strip leading "Wednesday 24/06/2026 — " if present
    const stripped = inner.replace(/^[A-Za-z]+\s+\d{1,2}\/\d{1,2}\/\d{4}\s*[—–-]\s*/i, "");
    return stripped.replace(/\s*\(Total:.*?\)\s*$/i, "").trim();
  }
  // Or a "## 📝 ... — Title" header
  const h2 = text.match(/##\s*📝[^\n]*[—–-]\s*([^\n]+)/);
  if (h2) return h2[1].trim();
  return "";
}

function extractTotalMin(text: string): number | null {
  const m =
    text.match(/Total:\s*~?(\d+)\s*min/i) ||
    text.match(/Total:\s*~?(\d+)\s*minutes/i);
  return m ? Number(m[1]) : null;
}

function extractMusicBpm(text: string): string | null {
  const m = text.match(/🎵?\s*([0-9]{2,3}(?:\s*[-–]\s*[0-9]{2,3})?)\s*BPM/i);
  return m ? `${m[1].replace(/\s+/g, "")} BPM` : null;
}

function intensityFromText(text: string, hrZone: string): string {
  const lower = text.toLowerCase();
  if (/race[- ]pace|tempo|threshold/.test(lower)) return "Race pace";
  if (/easy|recovery|jog/.test(lower)) return "Easy";
  if (/walk/.test(lower) && !/jog|run/.test(lower)) return "Walk";
  if (/vo2|hard|all[- ]out|sprint/.test(lower)) return "Hard";
  if (/warm[- ]?up/.test(lower)) return "Easy";
  if (/cool[- ]?down/.test(lower)) return "Easy";
  return hrZone || "Steady";
}

// ── shape A: intervals.icu line list ───────────────────────────────────────
function tryParseIntervalsList(text: string): EditedSegment[] | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const out: EditedSegment[] = [];
  // Pattern: "1. Warm Up Walk — 05:00 (mm:ss) — No pace"
  const re =
    /^\d+\.\s*(.+?)\s*[—–-]\s*(\d{1,2}:\d{2})(?:\s*\([^)]*\))?\s*[—–-]\s*(.+)$/;
  for (const raw of lines) {
    const m = raw.match(re);
    if (!m) continue;
    const [, name, dur, paceRaw] = m;
    if (MOBILITY_RE.test(name)) continue;
    const pace = /no pace/i.test(paceRaw) ? "—" : extractPace(paceRaw) || paceRaw.trim();
    out.push({
      segment: name.trim(),
      duration: normaliseDuration(dur),
      target: pace,
      hrZone: "",
      notes: "",
    });
  }
  return out.length >= 2 ? out : null;
}

// ── shape B: numbered/bulleted prose ───────────────────────────────────────
function tryParseNumberedProse(text: string): EditedSegment[] | null {
  // Split into numbered blocks: "1. …", "2. …", …
  const norm = text.replace(/\r/g, "");
  const blocks: string[] = [];
  const re = /(^|\n)\s*(\d+)\.\s+/g;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
    starts.push(m.index + (m[1] ? m[1].length : 0));
  }
  if (starts.length < 2) return null;
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : norm.length;
    blocks.push(norm.slice(starts[i], end).trim());
  }

  const out: EditedSegment[] = [];
  for (const block of blocks) {
    const firstLine = block.split("\n", 1)[0];
    const segmentName = cleanSegmentName(firstLine);
    if (!segmentName) continue;
    if (MOBILITY_RE.test(segmentName) || MOBILITY_RE.test(block)) continue;

    // Bullets / continuation lines
    const rest = block.slice(firstLine.length);
    const bullets = rest
      .split(/\n|•|\u2022/)
      .map((b) => b.trim())
      .filter(Boolean);

    // Bullet 1 typically holds duration + structure: "5 min walk, 10 min easy jog"
    const structure = bullets[0] || "";
    const totalMin = (() => {
      const parts = structure.match(/(\d+(?:\.\d+)?\s*min|\d{1,2}:\d{2})/g) || [];
      let sum = 0;
      for (const p of parts) {
        const v = durationToMin(p);
        if (v != null) sum += v;
      }
      return sum > 0 ? sum : null;
    })();

    const wholeBlock = block;
    const pace = extractPace(wholeBlock);
    const hrZone = extractHrZone(wholeBlock);
    const bpm = extractBpm(wholeBlock);

    let notes = "";
    // Pull notes after "🎵 …;" or after the last ";"
    const semi = wholeBlock.match(/🎵[^\n]*?;\s*(.+?)(?:\n|$)/);
    if (semi) notes = semi[1].trim();
    if (bpm) notes = notes ? `🎵 ${bpm}; ${notes}` : `🎵 ${bpm}`;

    let target = pace || intensityFromText(segmentName + " " + structure, hrZone);
    if (!target) target = hrZone || "Steady";

    const duration = totalMin != null
      ? (Number.isInteger(totalMin) ? `${totalMin} min` : `${totalMin.toFixed(1)} min`)
      : structure || "—";

    out.push({
      segment: segmentName,
      duration,
      target,
      hrZone: hrZone || "",
      notes,
    });
  }
  return out.length >= 2 ? out : null;
}

// ── shape C: markdown table ────────────────────────────────────────────────
function tryParseTable(text: string): EditedSegment[] | null {
  const lines = text.split("\n");
  const headerIdx = lines.findIndex((l) => /\|\s*Segment\s*\|/i.test(l));
  if (headerIdx === -1) return null;
  const rows: EditedSegment[] = [];
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("|")) break;
    const cells = line.split("|").map((c) => c.trim()).filter((_, j, arr) => j > 0 && j < arr.length - 1);
    if (cells.length < 4) continue;
    const [segment, duration, target, hrZone, notes = ""] = cells;
    if (MOBILITY_RE.test(segment)) continue;
    rows.push({ segment, duration, target, hrZone, notes });
  }
  return rows.length >= 2 ? rows : null;
}

export interface ParsedRecommendation {
  edited: EditedWorkout;
}

export function parseChatRecommendation(text: string): ParsedRecommendation | null {
  if (!text || text.length < 20) return null;

  // Try each shape in order of strictness.
  const segments =
    tryParseTable(text) ||
    tryParseIntervalsList(text) ||
    tryParseNumberedProse(text);

  if (!segments || segments.length < 2) return null;

  let title = extractTitle(text);
  if (!title) {
    // Last-ditch: use first non-empty line that looks like a name.
    const first = text.split("\n").find((l) => l.trim() && !/^[#\->|]/.test(l.trim()));
    title = first ? first.replace(/[*_`#]/g, "").trim().slice(0, 80) : "Updated Workout";
  }

  let totalMin = extractTotalMin(text);
  if (totalMin == null) {
    let sum = 0;
    for (const s of segments) {
      const v = durationToMin(s.duration);
      if (v != null) sum += v;
    }
    if (sum > 0) totalMin = Math.round(sum);
  }

  const musicBpm = extractMusicBpm(text) || undefined;

  return {
    edited: {
      title,
      segments,
      totalMin: totalMin ?? undefined,
      musicBpm,
    },
  };
}

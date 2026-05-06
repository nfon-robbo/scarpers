/**
 * Minimal FIT *workout-definition* parser.
 *
 * The `fit-file-parser` package we use only keeps the LAST `workout_step`
 * message it sees (it does `fitObj[type] = message` in its default branch),
 * which makes structured-workout FIT files unreadable. This module reads the
 * binary FIT format directly and extracts every workout_step plus the
 * top-level workout metadata, then emits the intervals.icu workout-text
 * format used by the rest of the app.
 *
 * Spec references: FIT Profile (Garmin SDK), message numbers 26/27.
 */

interface FieldDef {
  num: number;
  size: number;
  baseType: number;
}

interface DefMessage {
  globalNum: number;
  littleEndian: boolean;
  fields: FieldDef[];
  devFields: FieldDef[];
}

export interface FitWorkoutStep {
  messageIndex?: number;
  name?: string;
  durationType?: number;
  durationValue?: number;
  targetType?: number;
  targetValue?: number;
  customLow?: number;
  customHigh?: number;
  intensity?: number;
}

export interface FitWorkout {
  name?: string;
  sport?: string;
  steps: FitWorkoutStep[];
}

const BASE_TYPE_SIZES: Record<number, number> = {
  0x00: 1, 0x01: 1, 0x02: 1, 0x83: 2, 0x84: 2, 0x85: 4, 0x86: 4,
  0x07: 1, 0x88: 4, 0x89: 8, 0x0A: 1, 0x8B: 2, 0x8C: 4, 0x0D: 1,
  0x8E: 8, 0x8F: 8, 0x10: 8,
};

function readUint(view: DataView, offset: number, size: number, le: boolean): number {
  if (size === 1) return view.getUint8(offset);
  if (size === 2) return view.getUint16(offset, le);
  if (size === 4) return view.getUint32(offset, le);
  return 0;
}

function readString(view: DataView, offset: number, size: number): string {
  const bytes: number[] = [];
  for (let i = 0; i < size; i++) {
    const b = view.getUint8(offset + i);
    if (b === 0) break;
    bytes.push(b);
  }
  return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
}

const SPORT_NAMES: Record<number, string> = {
  0: "generic", 1: "running", 2: "cycling", 5: "swimming", 11: "walking",
  17: "hiking",
};

export function parseFitWorkout(buffer: ArrayBuffer): FitWorkout | null {
  const view = new DataView(buffer);
  if (buffer.byteLength < 14) return null;

  const headerSize = view.getUint8(0);
  const dataSize = view.getUint32(4, true);
  // ".FIT" magic at bytes 8-11
  if (
    view.getUint8(8) !== 0x2e || view.getUint8(9) !== 0x46 ||
    view.getUint8(10) !== 0x49 || view.getUint8(11) !== 0x54
  ) return null;

  const localDefs: Record<number, DefMessage> = {};
  const steps: FitWorkoutStep[] = [];
  let workoutName: string | undefined;
  let sport: string | undefined;
  let fileType: number | undefined;

  let offset = headerSize;
  const end = headerSize + dataSize;

  while (offset < end) {
    const recordHeader = view.getUint8(offset);
    offset += 1;

    const isCompressed = (recordHeader & 0x80) !== 0;
    if (isCompressed) {
      // Compressed timestamp data message — references a local message type.
      const localType = (recordHeader >> 5) & 0x03;
      const def = localDefs[localType];
      if (!def) return null;
      offset += def.fields.reduce((s, f) => s + f.size, 0);
      offset += def.devFields.reduce((s, f) => s + f.size, 0);
      continue;
    }

    const isDefinition = (recordHeader & 0x40) !== 0;
    const hasDevData = (recordHeader & 0x20) !== 0;
    const localType = recordHeader & 0x0f;

    if (isDefinition) {
      offset += 1; // reserved
      const arch = view.getUint8(offset); offset += 1;
      const le = arch === 0;
      const globalNum = view.getUint16(offset, le); offset += 2;
      const numFields = view.getUint8(offset); offset += 1;
      const fields: FieldDef[] = [];
      for (let i = 0; i < numFields; i++) {
        const num = view.getUint8(offset); offset += 1;
        const size = view.getUint8(offset); offset += 1;
        const baseType = view.getUint8(offset); offset += 1;
        fields.push({ num, size, baseType });
      }
      const devFields: FieldDef[] = [];
      if (hasDevData) {
        const numDev = view.getUint8(offset); offset += 1;
        for (let i = 0; i < numDev; i++) {
          const num = view.getUint8(offset); offset += 1;
          const size = view.getUint8(offset); offset += 1;
          const baseType = view.getUint8(offset); offset += 1;
          devFields.push({ num, size, baseType });
        }
      }
      localDefs[localType] = { globalNum, littleEndian: le, fields, devFields };
      continue;
    }

    // Data message
    const def = localDefs[localType];
    if (!def) return null;

    const fieldStart = offset;
    const dataSize = def.fields.reduce((s, f) => s + f.size, 0)
                   + def.devFields.reduce((s, f) => s + f.size, 0);

    const readField = (field: FieldDef): number | string | null => {
      // Strings (base type 0x07)
      if (field.baseType === 0x07) {
        return readString(view, offset, field.size);
      }
      // Numeric — handle integer types (signed + unsigned, byte/short/long)
      const isSigned = [0x01, 0x83, 0x85, 0x88].includes(field.baseType);
      const isUnsigned = [0x02, 0x0A, 0x84, 0x86, 0x07, 0x0D].includes(field.baseType);
      const baseSize = BASE_TYPE_SIZES[field.baseType] || 1;
      if (field.size === baseSize) {
        if (isSigned) {
          if (baseSize === 1) return view.getInt8(offset);
          if (baseSize === 2) return view.getInt16(offset, def.littleEndian);
          if (baseSize === 4) return view.getInt32(offset, def.littleEndian);
        }
        if (isUnsigned || true) {
          return readUint(view, offset, baseSize, def.littleEndian);
        }
      }
      return null;
    };

    if (def.globalNum === 0) {
      // file_id
      for (const f of def.fields) {
        if (f.num === 0) { // type
          fileType = readUint(view, offset, 1, def.littleEndian);
        }
        offset += f.size;
      }
      offset += def.devFields.reduce((s, ff) => s + ff.size, 0);
    } else if (def.globalNum === 26) {
      // workout
      for (const f of def.fields) {
        if (f.num === 8 && f.baseType === 0x07) {
          workoutName = readString(view, offset, f.size);
        } else if (f.num === 4) {
          // sport enum
          const v = readUint(view, offset, 1, def.littleEndian);
          sport = SPORT_NAMES[v] || `sport_${v}`;
        }
        offset += f.size;
      }
      offset += def.devFields.reduce((s, ff) => s + ff.size, 0);
    } else if (def.globalNum === 27) {
      // workout_step
      const step: FitWorkoutStep = {};
      for (const f of def.fields) {
        const val = readField(f);
        switch (f.num) {
          case 254: step.messageIndex = typeof val === "number" ? val : undefined; break;
          case 0: step.name = typeof val === "string" ? val.replace(/\u0000/g, "").trim() : undefined; break;
          case 1: step.durationType = typeof val === "number" ? val : undefined; break;
          case 2: step.durationValue = typeof val === "number" ? val : undefined; break;
          case 3: step.targetType = typeof val === "number" ? val : undefined; break;
          case 4: step.targetValue = typeof val === "number" ? val : undefined; break;
          case 5: step.customLow = typeof val === "number" ? val : undefined; break;
          case 6: step.customHigh = typeof val === "number" ? val : undefined; break;
          case 7: step.intensity = typeof val === "number" ? val : undefined; break;
        }
        offset += f.size;
      }
      offset += def.devFields.reduce((s, ff) => s + ff.size, 0);
      steps.push(step);
    } else {
      offset += dataSize;
    }

    // sanity guard
    if (offset !== fieldStart + dataSize && offset < fieldStart + dataSize) {
      offset = fieldStart + dataSize;
    }
  }

  if (fileType !== undefined && fileType !== 5) {
    // Not a workout file (5 = workout per FIT)
    return null;
  }

  return { name: workoutName, sport, steps };
}

// ---------- Conversion to intervals.icu workout text ----------

const INTENSITY_LABEL: Record<number, string> = {
  0: "Active", 1: "Rest", 2: "Warmup", 3: "Cooldown", 4: "Recovery",
  5: "Interval", 6: "Other",
};

function fmtDuration(durationType?: number, durationValue?: number): string {
  if (durationType === 0 && durationValue != null) {
    // time in milliseconds
    const totalSec = Math.round(durationValue / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (s === 0) return `${m}m`;
    if (m === 0) return `${s}s`;
    return `${m}m${s}s`;
  }
  if (durationType === 1 && durationValue != null) {
    // distance in centimetres
    const km = durationValue / 100000;
    if (km >= 1) return `${km.toFixed(km % 1 === 0 ? 0 : 2)}km`;
    return `${Math.round(durationValue / 100)}m`;
  }
  // open / lap-button
  return "lap";
}

function fmtTarget(s: FitWorkoutStep): string {
  // Heart rate (target_type === 1)
  if (s.targetType === 1) {
    const lo = s.customLow;
    const hi = s.customHigh;
    if (lo != null && hi != null && lo > 0 && hi > 0) {
      // FIT spec: if value < 100, it's % max HR; otherwise BPM + 100
      const toBpm = (v: number) => (v < 100 ? null : v - 100);
      const loBpm = toBpm(lo);
      const hiBpm = toBpm(hi);
      if (loBpm != null && hiBpm != null) return `${loBpm}-${hiBpm}bpm HR`;
    }
    if (s.targetValue && s.targetValue >= 1 && s.targetValue <= 5) {
      return `Z${s.targetValue} HR`;
    }
  }
  // Speed (target_type === 0) — custom values in mm/s
  if (s.targetType === 0 && s.customLow && s.customHigh) {
    const toPace = (mmps: number) => {
      const mps = mmps / 1000;
      if (mps <= 0) return null;
      let secPerKm = Math.round(1000 / mps);
      const m = Math.floor(secPerKm / 60);
      const sec = secPerKm % 60;
      return `${m}:${String(sec).padStart(2, "0")}/km`;
    };
    // FIT stores faster speed (= lower min/km) in customHigh
    const fast = toPace(s.customHigh);
    const slow = toPace(s.customLow);
    if (fast && slow) return `${fast}-${slow} Pace`;
  }
  return "";
}

/**
 * Convert a parsed FIT workout into intervals.icu native workout text.
 * Handles repeat steps (durationType 6 = repeat_until_steps_cmplt, value = repeats,
 * targetValue = index of step to jump back to).
 */
export function fitWorkoutToIntervalsText(w: FitWorkout): string {
  const steps = w.steps;
  if (!steps.length) return "";

  // Build a map messageIndex -> step
  const lines: string[] = [];

  let i = 0;
  while (i < steps.length) {
    const step = steps[i];

    // Repeat marker?
    if (step.durationType === 6 || step.durationType === 7 || step.durationType === 8) {
      const reps = step.durationValue ?? 1;
      const jumpTo = step.targetValue ?? 0;
      // Collect prior steps from jumpTo..i-1
      const block: FitWorkoutStep[] = [];
      for (let j = 0; j < steps.length; j++) {
        const s = steps[j];
        if (s.messageIndex != null && s.messageIndex >= jumpTo && j < i) {
          block.push(s);
        }
      }
      // Remove the previously-emitted lines for this block — we re-emit under Nx header.
      // Easier: when we encounter a repeat, drop the lines we already emitted for that range
      // and re-emit them inside the repeat group.
      const linesToDrop = block.length;
      for (let k = 0; k < linesToDrop; k++) {
        // also drop section headers preceding the block if they belong to it
        if (lines.length && lines[lines.length - 1].startsWith("- ")) lines.pop();
        else break;
      }
      lines.push("");
      lines.push(`${reps}x`);
      for (const b of block) {
        const dur = fmtDuration(b.durationType, b.durationValue);
        const tgt = fmtTarget(b);
        lines.push(`- ${dur}${tgt ? " " + tgt : ""}`.trim());
      }
      lines.push("");
      i += 1;
      continue;
    }

    // Regular step
    const dur = fmtDuration(step.durationType, step.durationValue);
    const tgt = fmtTarget(step);
    const intensityLabel = INTENSITY_LABEL[step.intensity ?? 0] || "Active";

    // Emit a section header for warmup/cooldown/recovery transitions
    const headerLabel =
      step.intensity === 2 ? "Warmup" :
      step.intensity === 3 ? "Cooldown" :
      step.intensity === 4 ? "Recovery" :
      step.intensity === 1 ? "Recovery" : null;

    if (headerLabel) {
      const last = lines[lines.length - 1];
      if (last !== headerLabel) {
        if (lines.length && lines[lines.length - 1] !== "") lines.push("");
        lines.push(headerLabel);
      }
    }

    lines.push(`- ${dur}${tgt ? " " + tgt : ""}`.trim());
    i += 1;
  }

  // Trim trailing blanks
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

/**
 * Splits a training-plan markdown into a "preserved past" portion and a
 * "future" portion (today onward), based on day headings of the form:
 *
 *   ### **Friday 15/05/2026** — Easy run (Total: 30min)
 *
 * Anything that appears before the first datable day heading (e.g. Season
 * Strategy Overview, week summaries) is treated as preamble and always kept
 * with the preserved past portion.
 *
 * If no datable headings are found, splitWorked is false and the caller
 * should fall back to its existing behaviour (regenerate the whole plan).
 */

const DAY_HEADING_RE = /^###\s+\*\*[^*]*?(\d{2})\/(\d{2})\/(\d{4})[^*]*\*\*/;

export interface PlanSplitResult {
  preservedPast: string;   // preamble + all day blocks dated strictly before todayISO
  futureToAdjust: string;  // all day blocks dated today or later
  splitWorked: boolean;
}

interface Block {
  iso: string | null; // YYYY-MM-DD, or null for the preamble
  text: string;
}

function tokenize(markdown: string): Block[] {
  const lines = markdown.split("\n");
  const blocks: Block[] = [];
  let current: Block = { iso: null, text: "" };

  for (const line of lines) {
    const m = line.match(DAY_HEADING_RE);
    if (m) {
      // flush previous block
      blocks.push(current);
      current = {
        iso: `${m[3]}-${m[2]}-${m[1]}`,
        text: line + "\n",
      };
    } else {
      current.text += line + "\n";
    }
  }
  blocks.push(current);
  return blocks;
}

export function splitPlanByDate(markdown: string, todayISO: string): PlanSplitResult {
  if (!markdown) {
    return { preservedPast: "", futureToAdjust: "", splitWorked: false };
  }

  const blocks = tokenize(markdown);
  const datedBlocks = blocks.filter(b => b.iso);
  if (datedBlocks.length === 0) {
    return { preservedPast: "", futureToAdjust: markdown, splitWorked: false };
  }

  const past: string[] = [];
  const future: string[] = [];

  for (const b of blocks) {
    if (b.iso === null) {
      // preamble — always preserved
      if (b.text.trim().length > 0) past.push(b.text);
      continue;
    }
    if (b.iso < todayISO) past.push(b.text);
    else future.push(b.text);
  }

  return {
    preservedPast: past.join("").replace(/\n+$/, ""),
    futureToAdjust: future.join("").replace(/\n+$/, ""),
    splitWorked: true,
  };
}

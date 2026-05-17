import { describe, it, expect } from "vitest";
import { splitPlanByDate } from "./plan-split";

const PREAMBLE = `# Season Strategy Overview\n\nFocus: build aerobic base.\n\n`;

const day = (date: string, title = "Easy run", total = "30min") =>
  `### **Day ${date}** — ${title} (Total: ${total})\n| Segment | Duration | Target | Notes |\n| Warm-up | 5 min | Z2 | 🎵 150 |\n\n`;

describe("splitPlanByDate", () => {
  it("returns splitWorked=false when no datable headings", () => {
    const md = "# Plan\n\nSome notes only.";
    const r = splitPlanByDate(md, "2026-05-17");
    expect(r.splitWorked).toBe(false);
    expect(r.futureToAdjust).toBe(md);
  });

  it("puts everything in past when today is after last workout", () => {
    const md = PREAMBLE + day("10/05/2026") + day("12/05/2026");
    const r = splitPlanByDate(md, "2026-05-20");
    expect(r.splitWorked).toBe(true);
    expect(r.preservedPast).toContain("10/05/2026");
    expect(r.preservedPast).toContain("12/05/2026");
    expect(r.preservedPast).toContain("Season Strategy");
    expect(r.futureToAdjust).toBe("");
  });

  it("puts everything in future when today is before first workout", () => {
    const md = PREAMBLE + day("20/05/2026") + day("22/05/2026");
    const r = splitPlanByDate(md, "2026-05-17");
    expect(r.splitWorked).toBe(true);
    expect(r.preservedPast).toContain("Season Strategy");
    expect(r.preservedPast).not.toContain("20/05/2026");
    expect(r.futureToAdjust).toContain("20/05/2026");
    expect(r.futureToAdjust).toContain("22/05/2026");
  });

  it("splits mixed plans at todayISO (today counts as future)", () => {
    const md =
      PREAMBLE +
      day("10/05/2026") +
      day("15/05/2026") +
      day("17/05/2026") +
      day("20/05/2026");
    const r = splitPlanByDate(md, "2026-05-17");
    expect(r.splitWorked).toBe(true);
    expect(r.preservedPast).toContain("10/05/2026");
    expect(r.preservedPast).toContain("15/05/2026");
    expect(r.preservedPast).not.toContain("17/05/2026");
    expect(r.futureToAdjust).toContain("17/05/2026");
    expect(r.futureToAdjust).toContain("20/05/2026");
  });

  it("preserves preamble verbatim in past", () => {
    const md = PREAMBLE + day("20/05/2026");
    const r = splitPlanByDate(md, "2026-05-17");
    expect(r.preservedPast.trim().startsWith("# Season Strategy Overview")).toBe(true);
  });
});

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, BorderStyle, WidthType, ShadingType,
} from "docx";
import { format } from "date-fns";
import type { ParsedWorkout } from "./plan-export";

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

function cell(text: string, opts: { bold?: boolean; shading?: string; width: number } = { width: 2000 }) {
  return new TableCell({
    borders: BORDERS,
    width: { size: opts.width, type: WidthType.DXA },
    shading: opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR, color: "auto" } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text: text || "", bold: opts.bold, size: 20 })] })],
  });
}

export async function generatePlanDocx(workouts: ParsedWorkout[], raceDistance?: string): Promise<Blob> {
  const sorted = [...workouts].sort((a, b) => {
    if (!a.dateObj || !b.dateObj) return 0;
    return a.dateObj.getTime() - b.dateObj.getTime();
  });

  const children: (Paragraph | Table)[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "Training Plan", bold: true, size: 40 })],
    }),
  ];

  if (raceDistance) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Goal: ${raceDistance}`, italics: true, size: 24 })],
      spacing: { after: 200 },
    }));
  }

  const colWidths = [1700, 1500, 2400, 1300, 2460]; // sums to 9360

  for (const w of sorted) {
    const dayLabel = w.dateObj ? format(w.dateObj, "EEEE") : "";
    const dateLabel = w.dateObj ? format(w.dateObj, "dd/MM/yyyy") : w.date;

    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 280, after: 80 },
      children: [new TextRun({ text: `${dayLabel} ${dateLabel}`, bold: true, size: 26 })],
    }));

    children.push(new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: w.title, bold: true, size: 22 })],
    }));

    if (w.segments.length > 0) {
      const headerRow = new TableRow({
        tableHeader: true,
        children: [
          cell("Segment", { bold: true, shading: "EAEAEA", width: colWidths[0] }),
          cell("Duration", { bold: true, shading: "EAEAEA", width: colWidths[1] }),
          cell("Target", { bold: true, shading: "EAEAEA", width: colWidths[2] }),
          cell("HR Zone", { bold: true, shading: "EAEAEA", width: colWidths[3] }),
          cell("Notes", { bold: true, shading: "EAEAEA", width: colWidths[4] }),
        ],
      });

      const rows = w.segments.map(s => new TableRow({
        children: [
          cell(s.segment, { width: colWidths[0] }),
          cell(s.duration, { width: colWidths[1] }),
          cell(s.target, { width: colWidths[2] }),
          cell(s.hrZone, { width: colWidths[3] }),
          cell(s.notes || "", { width: colWidths[4] }),
        ],
      }));

      children.push(new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: colWidths,
        rows: [headerRow, ...rows],
      }));
    } else {
      children.push(new Paragraph({
        children: [new TextRun({ text: w.rawText.replace(/[#*|]/g, "").trim(), size: 20 })],
      }));
    }
  }

  const doc = new Document({
    styles: {
      default: { document: { run: { font: "Arial", size: 22 } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 36, bold: true, font: "Arial" },
          paragraph: { spacing: { before: 240, after: 200 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 26, bold: true, font: "Arial", color: "6B21A8" },
          paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 1 } },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
        },
      },
      children,
    }],
  });

  return await Packer.toBlob(doc);
}

export type DownloadResult = {
  status: "shared" | "downloaded";
  /** Blob URL that can be opened in a new tab to view the file. Revoke when done. */
  url: string;
  revoke: () => void;
};

export async function downloadBlob(blob: Blob, filename: string): Promise<DownloadResult> {
  // Ensure correct MIME type so Android (Samsung Internet/Chrome) recognizes it as a downloadable file
  const docxBlob = blob.type
    ? blob
    : new Blob([blob], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

  const url = URL.createObjectURL(docxBlob);
  // Keep the URL alive long enough for the user to tap "Open" from the toast
  const revoke = () => URL.revokeObjectURL(url);
  setTimeout(revoke, 5 * 60 * 1000); // 5 min safety net

  // Prefer the native share/save sheet on mobile so user can pick where the file goes
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const file = new File([docxBlob], filename, { type: docxBlob.type });

  if (isMobile && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return { status: "shared", url, revoke };
    } catch (err) {
      // User cancelled or share failed — fall back to download link
    }
  }

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return { status: "downloaded", url, revoke };
}


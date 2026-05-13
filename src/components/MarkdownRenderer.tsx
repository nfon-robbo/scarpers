import React from "react";
import DOMPurify from "dompurify";

interface Props {
  content: string;
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );

// Apply inline markdown (bold, italic) to already-escaped text
const inlineMd = (escaped: string): string => {
  return escaped
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-foreground">$1</strong>')
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
};

const MarkdownRenderer: React.FC<Props> = ({ content }) => {
  const processMarkdown = (text: string): string => {
    const lines = text.split("\n");
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
      // Detect markdown table: line with pipes, followed by separator line
      if (
        lines[i]?.includes("|") &&
        i + 1 < lines.length &&
        /^\s*\|?\s*[-:]+[-|:\s]+$/.test(lines[i + 1])
      ) {
        const headerCells = lines[i].split("|").map((c) => c.trim()).filter(Boolean);
        i += 2;

        const bodyRows: string[][] = [];
        while (
          i < lines.length &&
          lines[i]?.includes("|") &&
          !/^\s*\|?\s*[-:]+[-|:\s]+$/.test(lines[i])
        ) {
          const cells = lines[i].split("|").map((c) => c.trim()).filter(Boolean);
          bodyRows.push(cells);
          i++;
        }

        let table =
          '<div class="overflow-x-auto my-4"><table class="w-full text-sm border-collapse">';
        table += "<thead><tr>";
        headerCells.forEach((h) => {
          table += `<th class="text-left p-2 border-b-2 border-border font-semibold text-foreground">${inlineMd(escapeHtml(h))}</th>`;
        });
        table += "</tr></thead><tbody>";
        bodyRows.forEach((row) => {
          table += '<tr class="border-b border-border/50">';
          row.forEach((cell) => {
            table += `<td class="p-2 text-muted-foreground">${inlineMd(escapeHtml(cell))}</td>`;
          });
          table += "</tr>";
        });
        table += "</tbody></table></div>";
        result.push(table);
        continue;
      }

      const raw = lines[i];

      // Horizontal rule
      if (/^---$/.test(raw)) {
        result.push('<hr class="my-6 border-border" />');
        i++;
        continue;
      }

      // Headers — escape captured text first
      const headerMatch = raw.match(/^(#{1,4})\s+(.+)$/);
      if (headerMatch) {
        const level = headerMatch[1].length;
        const text = inlineMd(escapeHtml(headerMatch[2]));
        const cls =
          level === 1
            ? 'text-2xl font-bold mt-8 mb-4'
            : level === 2
            ? 'text-xl font-bold mt-8 mb-3 pb-2 border-b border-border'
            : level === 3
            ? 'text-lg font-semibold mt-6 mb-2'
            : 'text-base font-semibold mt-4 mb-2';
        result.push(`<h${level} class="${cls}">${text}</h${level}>`);
        i++;
        continue;
      }

      // List items
      const liMatch = raw.match(/^- (.+)$/);
      if (liMatch) {
        result.push(
          `<li class="ml-4 list-disc list-inside text-sm leading-relaxed">${inlineMd(escapeHtml(liMatch[1]))}</li>`
        );
        i++;
        continue;
      }

      // Paragraphs
      if (raw.trim() !== "") {
        result.push(
          `<p class="text-sm leading-relaxed mb-2 text-muted-foreground">${inlineMd(escapeHtml(raw))}</p>`
        );
      } else {
        result.push("");
      }
      i++;
    }

    return result.join("\n");
  };

  const html = DOMPurify.sanitize(processMarkdown(content));

  return (
    <div className="prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: html }} />
  );
};

export default MarkdownRenderer;

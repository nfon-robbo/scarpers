import React from "react";

interface Props {
  content: string;
}

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
        // Parse header
        const headerCells = lines[i].split("|").map((c) => c.trim()).filter(Boolean);
        i += 2; // skip header + separator

        // Parse body rows
        const bodyRows: string[][] = [];
        while (i < lines.length && lines[i]?.includes("|") && !/^\s*\|?\s*[-:]+[-|:\s]+$/.test(lines[i])) {
          const cells = lines[i].split("|").map((c) => c.trim()).filter(Boolean);
          bodyRows.push(cells);
          i++;
        }

        // Build HTML table
        let table = '<div class="overflow-x-auto my-4"><table class="w-full text-sm border-collapse">';
        table += '<thead><tr>';
        headerCells.forEach((h) => {
          table += `<th class="text-left p-2 border-b-2 border-border font-semibold text-foreground">${h}</th>`;
        });
        table += '</tr></thead><tbody>';
        bodyRows.forEach((row) => {
          table += '<tr class="border-b border-border/50">';
          row.forEach((cell) => {
            table += `<td class="p-2 text-muted-foreground">${cell}</td>`;
          });
          table += '</tr>';
        });
        table += '</tbody></table></div>';
        result.push(table);
        continue;
      }

      let line = lines[i];


      // Headers
      line = line.replace(/^#### (.+)$/, '<h4 class="text-base font-semibold mt-4 mb-2">$1</h4>');
      line = line.replace(/^### (.+)$/, '<h3 class="text-lg font-semibold mt-6 mb-2">$1</h3>');
      line = line.replace(/^## (.+)$/, '<h2 class="text-xl font-bold mt-8 mb-3 pb-2 border-b border-border">$1</h2>');
      line = line.replace(/^# (.+)$/, '<h1 class="text-2xl font-bold mt-8 mb-4">$1</h1>');
      // Bold and italic
      line = line.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
      line = line.replace(/\*\*(.+?)\*\*/g, '<strong class="text-foreground">$1</strong>');
      line = line.replace(/\*(.+?)\*/g, '<em>$1</em>');
      // Unordered lists
      line = line.replace(/^- (.+)$/, '<li class="ml-4 list-disc list-inside text-sm leading-relaxed">$1</li>');
      // Horizontal rule
      line = line.replace(/^---$/, '<hr class="my-6 border-border" />');
      // Paragraphs
      if (!line.startsWith("<") && line.trim() !== "") {
        if (!line.startsWith("<li")) {
          line = `<p class="text-sm leading-relaxed mb-2 text-muted-foreground">${line}</p>`;
        }
      }

      result.push(line);
      i++;
    }

    return result.join("\n");
  };

  const html = processMarkdown(content);

  return (
    <div className="prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: html }} />
  );
};

export default MarkdownRenderer;

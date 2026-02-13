import React, { useCallback } from "react";
import { parseWorkoutsFromPlan, formatWorkoutForZepp } from "@/lib/plan-export";
import { Copy, Check } from "lucide-react";

interface Props {
  content: string;
}

const CopyForZeppButton: React.FC<{ workoutIndex: number; content: string }> = ({ workoutIndex, content }) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = useCallback(() => {
    const workouts = parseWorkoutsFromPlan(content);
    if (workouts[workoutIndex]) {
      navigator.clipboard.writeText(formatWorkoutForZepp(workouts[workoutIndex]));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [workoutIndex, content]);

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded text-xs bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
      title="Copy workout for Zepp app"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : "Copy for Zepp"}
    </button>
  );
};

const MarkdownRenderer: React.FC<Props> = ({ content }) => {
  // Pre-parse workouts to find date patterns for button injection
  const workouts = React.useMemo(() => parseWorkoutsFromPlan(content), [content]);
  const workoutDateSet = React.useMemo(() => {
    const map = new Map<string, number>();
    workouts.forEach((w, i) => {
      if (w.date) map.set(w.date, i);
    });
    return map;
  }, [workouts]);

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

      // Check if this line contains a workout date for button injection
      const dateMatch = line.match(/\*\*(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+)?(\d{1,2}\/\d{1,2}\/\d{4})\*\*/i);
      const hasZeppButton = dateMatch && workoutDateSet.has(dateMatch[1]);
      const zeppButtonPlaceholder = hasZeppButton ? `<!--zepp-btn-${workoutDateSet.get(dateMatch![1])}-->` : "";

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

      // Inject zepp button placeholder
      if (zeppButtonPlaceholder) {
        line = line + zeppButtonPlaceholder;
      }

      result.push(line);
      i++;
    }

    return result.join("\n");
  };

  const html = processMarkdown(content);

  // Split HTML by zepp button placeholders and render with React components
  const parts = html.split(/<!--zepp-btn-(\d+)-->/);

  return (
    <div className="prose-sm max-w-none">
      {parts.map((part, idx) => {
        if (idx % 2 === 1) {
          // This is a workout index
          const workoutIdx = parseInt(part, 10);
          return <CopyForZeppButton key={`zepp-${workoutIdx}`} workoutIndex={workoutIdx} content={content} />;
        }
        return (
          <span
            key={idx}
            dangerouslySetInnerHTML={{ __html: part }}
          />
        );
      })}
    </div>
  );
};

export default MarkdownRenderer;

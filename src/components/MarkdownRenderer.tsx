import React from "react";

interface Props {
  content: string;
}

const MarkdownRenderer: React.FC<Props> = ({ content }) => {
  // Simple markdown to HTML conversion
  const html = content
    // Headers
    .replace(/^#### (.+)$/gm, '<h4 class="text-base font-semibold mt-4 mb-2">$1</h4>')
    .replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold mt-6 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold mt-8 mb-3 pb-2 border-b border-border">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mt-8 mb-4">$1</h1>')
    // Bold and italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-foreground">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc list-inside text-sm leading-relaxed">$1</li>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr class="my-6 border-border" />')
    // Paragraphs - wrap non-tag lines
    .split("\n")
    .map((line) => {
      if (
        line.startsWith("<") ||
        line.trim() === ""
      )
        return line;
      if (!line.startsWith("<li"))
        return `<p class="text-sm leading-relaxed mb-2 text-muted-foreground">${line}</p>`;
      return line;
    })
    .join("\n");

  return (
    <div
      className="prose-sm max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export default MarkdownRenderer;

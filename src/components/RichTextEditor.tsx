import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Highlight from "@tiptap/extension-highlight";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Button } from "@/components/ui/button";
import React, { useCallback } from "react";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight,
  List, ListOrdered, Heading1, Heading2, Heading3,
  Link as LinkIcon, ImageIcon, Highlighter, Undo2, Redo2,
  Quote, Minus, Code,
  Table as TableIcon, Rows3, Columns3, Trash2,
  ArrowUpFromLine, ArrowDownFromLine, ArrowLeftFromLine, ArrowRightFromLine,
} from "lucide-react";

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
}

const MenuButton = React.forwardRef<
  HTMLButtonElement,
  { active?: boolean; onClick: () => void; children: React.ReactNode; title: string }
>(({ active, onClick, children, title }, ref) => (
  <Button
    ref={ref}
    type="button"
    variant={active ? "default" : "ghost"}
    size="icon"
    className="h-8 w-8"
    onClick={(e) => {
      e.preventDefault();
      onClick();
    }}
    title={title}
  >
    {children}
  </Button>
));
MenuButton.displayName = "MenuButton";

const RichTextEditor = ({ content, onChange }: RichTextEditorProps) => {
  const handleUpdate = useCallback(
    ({ editor }: { editor: any }) => {
      onChange(editor.getHTML());
    },
    [onChange]
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        paragraph: {},
      }),
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Link.configure({ openOnClick: false }),
      Image,
      Highlight.configure({ multicolor: false }),
    ],
    content,
    onUpdate: handleUpdate,
  });

  if (!editor) return null;

  const addLink = () => {
    const url = window.prompt("Enter URL:");
    if (url) {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  };

  const addImage = () => {
    const url = window.prompt("Enter image URL:");
    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  };

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card">
      <div className="flex flex-wrap gap-0.5 p-2 border-b border-border bg-muted/30">
        <MenuButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold"><Bold className="h-4 w-4" /></MenuButton>
        <MenuButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"><Italic className="h-4 w-4" /></MenuButton>
        <MenuButton active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline"><UnderlineIcon className="h-4 w-4" /></MenuButton>
        <MenuButton active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough"><Strikethrough className="h-4 w-4" /></MenuButton>
        <MenuButton active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()} title="Highlight"><Highlighter className="h-4 w-4" /></MenuButton>
        <div className="w-px bg-border mx-1" />
        <MenuButton active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1"><Heading1 className="h-4 w-4" /></MenuButton>
        <MenuButton active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2"><Heading2 className="h-4 w-4" /></MenuButton>
        <MenuButton active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3"><Heading3 className="h-4 w-4" /></MenuButton>
        <div className="w-px bg-border mx-1" />
        <MenuButton active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} title="Align left"><AlignLeft className="h-4 w-4" /></MenuButton>
        <MenuButton active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} title="Align center"><AlignCenter className="h-4 w-4" /></MenuButton>
        <MenuButton active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} title="Align right"><AlignRight className="h-4 w-4" /></MenuButton>
        <div className="w-px bg-border mx-1" />
        <MenuButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list"><List className="h-4 w-4" /></MenuButton>
        <MenuButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list"><ListOrdered className="h-4 w-4" /></MenuButton>
        <MenuButton active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote"><Quote className="h-4 w-4" /></MenuButton>
        <MenuButton active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="Code block"><Code className="h-4 w-4" /></MenuButton>
        <MenuButton active={false} onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal rule"><Minus className="h-4 w-4" /></MenuButton>
        <div className="w-px bg-border mx-1" />
        <MenuButton active={editor.isActive("link")} onClick={addLink} title="Add link"><LinkIcon className="h-4 w-4" /></MenuButton>
        <MenuButton active={false} onClick={addImage} title="Add image"><ImageIcon className="h-4 w-4" /></MenuButton>
        <div className="flex-1" />
        <MenuButton active={false} onClick={() => editor.chain().focus().undo().run()} title="Undo"><Undo2 className="h-4 w-4" /></MenuButton>
        <MenuButton active={false} onClick={() => editor.chain().focus().redo().run()} title="Redo"><Redo2 className="h-4 w-4" /></MenuButton>
      </div>
      <EditorContent
        editor={editor}
        className="rich-text-editor p-4 min-h-[300px] focus-within:outline-none [&_.ProseMirror]:min-h-[280px] [&_.ProseMirror]:outline-none [&_.ProseMirror]:leading-7 text-foreground"
      />
    </div>
  );
};

export default RichTextEditor;

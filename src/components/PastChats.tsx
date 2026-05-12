import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageCircle, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface ThreadRow {
  id: string;
  title: string;
  updated_at: string;
}

const fmtRelative = (iso: string) => {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  // Fallback to UK date format DD/MM/YYYY
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
};

const PastChats = ({ bare = false }: { bare?: boolean } = {}) => {
  const { toast } = useToast();
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // Only show threads that actually have saved messages — empty threads
    // (e.g. created before the persistence fix) can't be resumed.
    const { data, error } = await supabase
      .from("chat_threads")
      .select("id, title, updated_at, chat_messages!inner(id)")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) {
      console.error("Failed to load threads:", error);
    }
    const seen = new Set<string>();
    const unique = ((data as ThreadRow[]) || []).filter(t => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
    setThreads(unique);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const resume = (id: string) => {
    window.dispatchEvent(new CustomEvent("open-chat-thread", { detail: { threadId: id } }));
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("chat_threads").delete().eq("id", id);
    if (error) {
      toast({ title: "Couldn't delete chat", description: error.message, variant: "destructive" });
      return;
    }
    setThreads(prev => prev.filter(t => t.id !== id));
    toast({ title: "Chat deleted" });
  };

  const body = (
    loading ? (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    ) : threads.length === 0 ? (
      <p className="text-sm text-muted-foreground py-2">
        No previous chats yet. Start a conversation with the chat bubble.
      </p>
    ) : (
      <ul className="divide-y divide-border/50 -my-2">
        {threads.map(t => (
          <li key={t.id} className="flex items-center gap-2 py-2">
            <button
              onClick={() => resume(t.id)}
              className="flex-1 min-w-0 text-left rounded-md px-2 py-1.5 hover:bg-accent transition-colors"
            >
              <p className="text-sm font-medium truncate">{t.title}</p>
              <p className="text-xs text-muted-foreground">{fmtRelative(t.updated_at)}</p>
            </button>
            <Button size="sm" variant="ghost" onClick={() => resume(t.id)}>
              Continue
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete "{t.title}" and all its messages. This can't be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => remove(t.id)}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </li>
        ))}
      </ul>
    )
  );

  if (bare) return <>{body}</>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <MessageCircle className="w-5 h-5" />
          Previous chats
        </CardTitle>
        <CardDescription>Resume a past conversation with the AI coach.</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
};

export default PastChats;

import { useEffect, useState, useCallback } from "react";
import { Bell, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Notification = {
  id: string;
  title: string;
  body: string;
  kind: string;
  read_at: string | null;
  created_at: string;
};

const NotificationBell = ({ floating = false }: { floating?: boolean }) => {
  const { user } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("user_notifications" as any)
      .select("id, title, body, kind, read_at, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30);
    setItems((data ?? []) as unknown as Notification[]);
  }, [user]);

  const playChime = useCallback(() => {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const now = ctx.currentTime;
      const notes = [880, 1320]; // A5, E6 — short pleasant two-tone
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const start = now + i * 0.12;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.4);
      });
      setTimeout(() => ctx.close().catch(() => {}), 800);
    } catch {
      /* ignore audio errors */
    }
  }, []);

  useEffect(() => {
    load();
    if (!user) return;
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "user_notifications", filter: `user_id=eq.${user.id}` },
        () => {
          playChime();
          load();
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "user_notifications", filter: `user_id=eq.${user.id}` },
        () => load(),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "user_notifications", filter: `user_id=eq.${user.id}` },
        () => load(),
      )
      .subscribe();
    const interval = setInterval(load, 60_000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [user, load, playChime]);

  const unread = items.filter((i) => !i.read_at).length;

  const markAllRead = async () => {
    if (!user || unread === 0) return;
    await supabase
      .from("user_notifications" as any)
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("read_at", null);
    load();
  };

  const remove = async (id: string) => {
    await supabase.from("user_notifications" as any).delete().eq("id", id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (v) setTimeout(markAllRead, 800);
  };

  if (!user || items.length === 0) return null;

  const bell = (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Notifications"
          className="relative rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50"
        >
          <Bell className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center glow-sm">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-0 glass-strong border-border/60">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <p className="text-sm font-semibold">Notifications</p>
          {items.length > 0 && unread > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground px-4 py-8 text-center">
              You're all caught up.
            </p>
          ) : (
            <ul className="divide-y divide-border/50">
              {items.map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    "px-4 py-3 group relative",
                    !n.read_at && "bg-primary/5",
                  )}
                >
                  <div className="flex items-start gap-2">
                    {!n.read_at && (
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{n.title}</p>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-0.5">
                        {n.body}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {new Date(n.created_at).toLocaleString("en-GB")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(n.id)}
                      aria-label="Dismiss"
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1 -m-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );

  if (floating) {
    return (
      <div className="md:hidden fixed top-3 right-3 z-40" style={{ top: "calc(env(safe-area-inset-top) + 0.5rem)" }}>
        <div className="glass-strong rounded-xl shadow-lg">
          {bell}
        </div>
      </div>
    );
  }

  return bell;
};

export default NotificationBell;

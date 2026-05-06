import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { MessageCircle, Send, Loader2, X, Minimize2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { streamAICoach } from "@/lib/ai-stream";
import { parseWorkoutsFromPlan } from "@/lib/plan-export";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-coach`;

const AIChatbot = () => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const applyChange = useCallback(async (
    recommendationText: string,
    scope: { kind: "day"; dateUk: string } | { kind: "plan" },
  ) => {
    if (loading) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      toast({ title: "Please sign in", variant: "destructive" });
      return;
    }
    // Load the active plan for this user.
    const { data: plan } = await supabase
      .from("training_plans")
      .select("id, content, race_distance, goal_time, training_days, start_date")
      .eq("user_id", session.user.id)
      .eq("archived", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!plan?.content) {
      toast({ title: "No active plan", description: "Generate a training plan first.", variant: "destructive" });
      return;
    }

    setLoading(true);
    setMessages(prev => [...prev, {
      role: "assistant",
      content: scope.kind === "day"
        ? `✏️ Updating your ${scope.dateUk} session…`
        : "✏️ Applying the change to your plan…",
    }]);

    const finishWith = (msg: string) => {
      setMessages(prev => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: msg };
        return copy;
      });
      setLoading(false);
    };

    // ─── SINGLE-DAY CHANGE ────────────────────────────────────────────────
    if (scope.kind === "day") {
      // Parse DD/MM/YYYY → yyyy-mm-dd, then locate that workout in the plan.
      const m = scope.dateUk.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (!m) { finishWith("⚠️ Couldn't parse the date for that change."); return; }
      const [, dd, mm, yyyy] = m;
      const isoDate = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;

      const workouts = parseWorkoutsFromPlan(plan.content);
      const target = workouts.find(w => {
        if (!w.dateObj) return false;
        const y = w.dateObj.getFullYear();
        const mo = String(w.dateObj.getMonth() + 1).padStart(2, "0");
        const d = String(w.dateObj.getDate()).padStart(2, "0");
        return `${y}-${mo}-${d}` === isoDate;
      });
      if (!target?.rawText) {
        finishWith(`⚠️ Couldn't find a workout on ${scope.dateUk} in your plan.`);
        return;
      }

      // Build today_workout block (same shape the day-adjust prompt expects).
      let todayWorkoutBlock = `**${target.title}**\n`;
      if (target.segments.length > 0) {
        todayWorkoutBlock += "| Segment | Duration | Target | HR Zone | Notes |\n";
        todayWorkoutBlock += "|---------|----------|--------|---------|-------|\n";
        for (const s of target.segments) {
          todayWorkoutBlock += `| ${s.segment} | ${s.duration} | ${s.target} | ${s.hrZone} | ${s.notes || ""} |\n`;
        }
      }
      // Append the chat recommendation so the AI knows WHAT to change.
      todayWorkoutBlock += `\n\nCOACH RECOMMENDATION TO APPLY (from chat):\n${recommendationText}`;

      let dayResp = "";
      streamAICoach({
        type: "day-adjust",
        token: session.access_token,
        targetDate: isoDate,
        todayWorkout: todayWorkoutBlock,
        onDelta: (t) => { dayResp += t; },
        onDone: async () => {
          // Extract the new "## 📝 Workout for Today" block.
          const sec = dayResp.match(/##\s*📝\s*Workout for Today\s*\n([\s\S]*?)(?=\n##\s|$)/i);
          if (!sec) { finishWith("⚠️ Couldn't extract the adjusted workout."); return; }
          const adjusted = sec[1].trim();

          // Splice it into the existing plan in place of the original raw block.
          const rawLines = target.rawText!.split("\n");
          const dateLine = rawLines[0];
          const newTitleMatch = adjusted.match(/\*\*([^*]+)\*\*/);
          const newTitle = newTitleMatch ? newTitleMatch[1] : target.title;
          const datePrefix = dateLine.match(/(\*\*[^*]*\d{1,2}\/\d{1,2}\/\d{4}\*\*\s*[-–:]\s*)/);
          const newDateLine = datePrefix ? `${datePrefix[1]}${newTitle}` : dateLine;
          const adjustedBody = adjusted.replace(/^\*\*[^*]+\*\*\s*\n?/, "").trim();
          const replacement = `${newDateLine}\n\n${adjustedBody}`;

          const idx = plan.content!.indexOf(target.rawText!);
          if (idx === -1) { finishWith("⚠️ Couldn't locate the workout in your plan."); return; }
          const updated = plan.content!.slice(0, idx) + replacement + plan.content!.slice(idx + target.rawText!.length);

          await supabase.from("training_plans").update({ content: updated }).eq("id", plan.id);
          finishWith(`✅ Done — your **${scope.dateUk}** session has been updated. Reload the Training Plan page to see it.`);
          toast({ title: "Workout updated", description: scope.dateUk });
        },
        onError: (err) => finishWith(`⚠️ Couldn't apply the change: ${err}`),
      });
      return;
    }

    // ─── FULL-PLAN CHANGE ─────────────────────────────────────────────────
    let revised = "";
    streamAICoach({
      type: "plan-adjust",
      token: session.access_token,
      raceDistance: plan.race_distance || undefined,
      goalTime: plan.goal_time || undefined,
      trainingDays: (plan.training_days as string[] | null) || undefined,
      startDate: plan.start_date || undefined,
      currentPlan: plan.content,
      adjustment: "apply",
      reviewText: recommendationText,
      onDelta: (t) => { revised += t; },
      onDone: async () => {
        if (!revised.trim()) { finishWith("⚠️ Couldn't apply the change — please try again."); return; }
        await supabase.from("training_plans").update({ archived: true }).eq("id", plan.id);
        await supabase.from("training_plans").insert({
          user_id: session.user.id,
          race_distance: plan.race_distance,
          goal_time: plan.goal_time,
          training_days: plan.training_days,
          start_date: plan.start_date,
          content: revised,
        } as any);
        finishWith("✅ Done — your plan has been updated. Reload the Training Plan page to see the new sessions.");
        toast({ title: "Plan updated", description: "AI coach applied the change." });
      },
      onError: (err) => finishWith(`⚠️ Couldn't apply the change: ${err}`),
    });
  }, [loading, toast]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast({ title: "Please sign in", variant: "destructive" });
      return;
    }

    const userMsg: Message = { role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    let assistantContent = "";

    try {
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ type: "chat", messages: text }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Request failed" }));
        toast({ title: "Chat error", description: err.error || `Error ${resp.status}`, variant: "destructive" });
        setLoading(false);
        return;
      }

      if (!resp.body) { setLoading(false); return; }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Add empty assistant message
      setMessages(prev => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantContent += content;
              setMessages(prev => {
                const copy = [...prev];
                copy[copy.length - 1] = { role: "assistant", content: assistantContent };
                return copy;
              });
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }
    } catch (e: any) {
      toast({ title: "Chat failed", description: e.message, variant: "destructive" });
    }

    setLoading(false);
  }, [input, loading, toast]);

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        size="lg"
        className="fixed bottom-6 right-6 z-50 rounded-full h-14 w-14 shadow-lg p-0"
      >
        <MessageCircle className="w-6 h-6" />
      </Button>
    );
  }

  return (
    <Card className="fixed bottom-6 right-6 z-50 w-[360px] sm:w-[400px] h-[500px] shadow-2xl flex flex-col">
      <CardHeader className="p-3 border-b flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-primary" />
          AI Coach Chat
        </CardTitle>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}>
          <X className="w-4 h-4" />
        </Button>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground text-sm py-6 space-y-3">
              <MessageCircle className="w-8 h-8 mx-auto opacity-40" />
              <p>Ask me anything about your training!</p>
              <div className="flex flex-wrap justify-center gap-2 px-2">
                {[
                  "What should I eat before my long run?",
                  "Is my training plan working?",
                  "Should I run today?",
                  "Do I need to drink water before a run?",
                  "When is the best time for me to run?",
                  "How is my recovery looking?",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => { setInput(q); }}
                    className="text-xs bg-muted hover:bg-accent rounded-full px-3 py-1.5 transition-colors text-left"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg, i) => {
            const hasAction = msg.role === "assistant" && /\[\[ACTION:recommendation\]\]/.test(msg.content);
            const cleaned = hasAction ? msg.content.replace(/\[\[ACTION:recommendation\]\]/g, "").trim() : msg.content;
            const isLastAssistant = msg.role === "assistant" && i === messages.length - 1;
            const showActions = hasAction && isLastAssistant && !loading;
            return (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <MarkdownRenderer content={cleaned || "..."} />
                  ) : (
                    cleaned
                  )}
                  {showActions && (
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1 h-8 text-xs"
                        disabled={loading}
                        onClick={() => applyChange(cleaned)}
                      >
                        Make the change
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 h-8 text-xs"
                        disabled={loading}
                        onClick={() => {
                          setMessages(prev => [...prev, { role: "assistant", content: "Got it — keeping the session as planned." }]);
                        }}
                      >
                        Keep as it is
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {loading && messages[messages.length - 1]?.role === "user" && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-3 py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            </div>
          )}
        </div>
        <div className="p-3 border-t flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && sendMessage()}
            placeholder="Ask about your training..."
            disabled={loading}
            className="text-sm"
          />
          <Button size="icon" onClick={sendMessage} disabled={loading || !input.trim()}>
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default AIChatbot;

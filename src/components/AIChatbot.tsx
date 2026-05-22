import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { MessageCircle, Send, Loader2, X, Minimize2, Check, Square, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { streamAICoach } from "@/lib/ai-stream";
import { parseWorkoutsFromPlan } from "@/lib/plan-export";
import { pushUndoEntry } from "@/lib/plan-undo-history";
import { enforceAndLog } from "@/lib/plan-validation";
import {
  applySkipSession,
  applyMoveSession,
  applyReplaceWithRecovery,
  applyEditWorkout,
  getMoveTargetDate,
  formatMoveTargetLabel,
  previewMoveCascade,
  detectRaceDateConflict,
  applyMoveCompressed,
  applyMoveAndShiftRace,
  formatRaceDateLabel,
} from "@/lib/plan-day-actions";
import { logPlanEdit } from "@/lib/plan-edit-log";
import { parseChatRecommendation } from "@/lib/chat-recommendation-parser";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-coach`;
const ACTION_MARKER_REGEX = /\[\[ACTION:(?:day:\d{1,2}\/\d{1,2}\/\d{4}|race-conflict:\d{1,2}\/\d{1,2}\/\d{4}|plan|recommendation)\]\]/g;

const isConcreteWorkoutEdit = (text: string) => {
  const lower = text.toLowerCase();
  if (/\b(no change needed|nothing needs to (?:be )?chang(?:e|ed)|do not change|don't change|wouldn't change|keep (?:it|the session|this) as (?:it is|planned)|intensity was appropriate|well-managed|not too intense)\b/.test(lower)) {
    return false;
  }
  return /\b(swap|replace|change|cut|reduce|shorten|postpone|move|reschedule|skip|remove|drop|add|extend|increase|scale|modify|convert|turn)\b/.test(lower)
    || /\b(rest day|easy run|walk-only|walk\/run|walk-run|fewer reps|less volume|lower intensity|make it shorter|make this shorter)\b/.test(lower);
};

const stripActionMarkers = (text: string) => text.replace(ACTION_MARKER_REGEX, "").trim();

const AIChatbot = () => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastUndo, setLastUndo] = useState<{ planId: string; prevContent: string; prevRaceDate?: string | null; dateUk: string } | null>(null);
  const [activePlanContent, setActivePlanContent] = useState<string | null>(null);
  const [activePlanRaceDate, setActivePlanRaceDate] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const geoRef = useRef<{ lat: number; lon: number } | null>(null);

  // Request geolocation once when chat opens so weather context is available.
  useEffect(() => {
    if (!open || geoRef.current || typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => { geoRef.current = { lat: pos.coords.latitude, lon: pos.coords.longitude }; },
      () => { /* user declined or unavailable — chat still works without weather */ },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 },
    );
  }, [open]);

  const stopReply = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const startNewChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setThreadId(null);
    setMessages([]);
    setInput("");
    setLoading(false);
  }, []);

  // Load a thread's messages from the database.
  const loadThread = useCallback(async (id: string) => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setThreadId(id);
    setMessages([]);
    const { data: thread } = await supabase
      .from("chat_threads")
      .select("title")
      .eq("id", id)
      .maybeSingle();
    const { data, error } = await supabase
      .from("chat_messages")
      .select("id, role, content, created_at")
      .eq("thread_id", id)
      .order("created_at", { ascending: true });
    if (error) {
      toast({ title: "Couldn't load chat", description: error.message, variant: "destructive" });
      return;
    }
    const loadedMessages = (data || []).map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
    if (loadedMessages.length === 0) {
      const recoveredText = thread?.title?.trim();
      if (recoveredText && recoveredText.toLowerCase() !== "new chat") {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const { error: recoverErr } = await supabase.from("chat_messages").insert({
            thread_id: id,
            user_id: session.user.id,
            role: "user",
            content: recoveredText,
          });
          if (recoverErr) console.error("Failed to recover empty chat from title:", recoverErr);
        }
        setMessages([{ role: "user", content: recoveredText }]);
        return;
      }
    }
    setMessages(loadedMessages);
  }, [toast]);

  // Listen for "open-chat-thread" events fired from Settings.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ threadId: string }>).detail;
      if (!detail?.threadId) return;
      setOpen(true);
      loadThread(detail.threadId);
    };
    window.addEventListener("open-chat-thread", handler);
    return () => window.removeEventListener("open-chat-thread", handler);
  }, [loadThread]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  // Cache the active plan content so the "Move" button can show its
  // dynamically computed target date (e.g. "Move to Wednesday 20 May")
  // without an async fetch at render time.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const { data: plan } = await supabase
        .from("training_plans")
        .select("content, race_date")
        .eq("user_id", session.user.id)
        .eq("archived", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (plan?.content) setActivePlanContent(plan.content);
      setActivePlanRaceDate(plan?.race_date ?? null);
    })();
    return () => { cancelled = true; };
  }, [open, messages.length]);

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

      // ── DETERMINISTIC PATH ──
      // If the chat recommendation already contains a structured workout, splice
      // it in directly — no second LLM round-trip. This avoids the day-adjust
      // "SURGICAL EDIT MODE" rules silently preserving the original session type.
      const parsed = parseChatRecommendation(recommendationText);
      if (parsed) {
        const result = applyEditWorkout(plan.content, scope.dateUk, parsed.edited);
        if (result) {
          const updated = enforceAndLog(result.updatedPlan, "chat recommendation direct apply").content;
          try {
            const rawOverrides = localStorage.getItem("plan-step-overrides");
            const overrides = rawOverrides ? JSON.parse(rawOverrides) : {};
            if (overrides && typeof overrides === "object") {
              delete overrides[isoDate];
              localStorage.setItem("plan-step-overrides", JSON.stringify(overrides));
              window.dispatchEvent(new CustomEvent("plan-step-overrides-cleared", { detail: { date: isoDate } }));
            }
          } catch {}
          pushUndoEntry(plan.id, plan.content, `${scope.dateUk} session`);
          await supabase.from("training_plans").update({ content: updated }).eq("id", plan.id);
          setLastUndo({ planId: plan.id, prevContent: plan.content, dateUk: scope.dateUk });
          await logPlanEdit({
            planId: plan.id,
            userId: session.user.id,
            dateUk: scope.dateUk,
            action: "edit",
            template: null,
            beforeTitle: target.title,
            afterTitle: parsed.edited.title,
            summary: `Applied chat recommendation: ${parsed.edited.title}`,
            details: { source: "chatbot_suggestion_direct", recommendation: recommendationText.slice(0, 2000) },
          });
          finishWith(`✅ Done — your **${scope.dateUk}** session has been replaced with **${parsed.edited.title}** exactly as suggested. Use the **Undo** button at the top of the Training Plan to revert.`);
          toast({ title: `Workout replaced with ${parsed.edited.title}`, description: `${scope.dateUk} — applied directly` });
          return;
        }
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
      // Fallback: pipe through day-adjust with a FULL REPLACEMENT directive so
      // the surgical-edit guard doesn't preserve the original session type.
      todayWorkoutBlock += `\n\nCOACH RECOMMENDATION TO APPLY (from chat):\nFULL REPLACEMENT: ${recommendationText}`;

      let dayResp = "";
      streamAICoach({
        type: "day-adjust",
        token: session.access_token,
        featureName: "chat-day-adjust",
        targetDate: isoDate,
        todayWorkout: todayWorkoutBlock,
        onDelta: (t) => { dayResp += t; },
        onDone: async () => {
          // Extract the new workout block. The day-adjust prompt emits
          // "## 📝 Recommended Workout — {date}", but be permissive so older
          // / slightly-off headers still apply.
          const sec =
            dayResp.match(/##\s*📝\s*Recommended Workout[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i) ||
            dayResp.match(/##\s*📝\s*Workout for Today[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i) ||
            dayResp.match(/##\s*📝[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i);
          // Final fallback: grab from the first **Title (Total: …)** line onward.
          let adjusted = sec ? sec[1].trim() : "";
          if (!adjusted) {
            const titleIdx = dayResp.search(/\*\*[^*\n]*Total:\s*~?\d+\s*min[^*\n]*\*\*/i);
            if (titleIdx >= 0) {
              const rest = dayResp.slice(titleIdx);
              const stop = rest.search(/\n##\s/);
              adjusted = (stop > 0 ? rest.slice(0, stop) : rest).trim();
            }
          }
          if (!adjusted) { finishWith("⚠️ Couldn't extract the adjusted workout."); return; }

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
          const updatedRaw = plan.content!.slice(0, idx) + replacement + plan.content!.slice(idx + target.rawText!.length);
          const updated = enforceAndLog(updatedRaw, "day-ahead in-place edit").content;

          pushUndoEntry(plan.id, plan.content!, `${scope.dateUk} session`);
          await supabase.from("training_plans").update({ content: updated }).eq("id", plan.id);
          setLastUndo({ planId: plan.id, prevContent: plan.content!, dateUk: scope.dateUk });
          await logPlanEdit({
            planId: plan.id,
            userId: session.user.id,
            dateUk: scope.dateUk,
            action: "edit",
            template: null,
            beforeTitle: target.title,
            afterTitle: newTitle,
            summary: `Applied AI coach recommendation: ${newTitle}`,
            details: { source: "chatbot_suggestion", recommendation: recommendationText.slice(0, 2000) },
          });
          finishWith(`✅ Done — your **${scope.dateUk}** session has been updated to **${newTitle}** as recommended. Use the **Undo** button at the top of the Training Plan to revert.`);
          toast({ title: `Workout updated to ${newTitle}`, description: `${scope.dateUk} — as recommended` });
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
      featureName: "chat-plan-adjust",
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
        const validatedRevised = enforceAndLog(revised, "full plan rewrite").content;
        await supabase.from("training_plans").update({ archived: true }).eq("id", plan.id);
        const newPlan = {
          user_id: session.user.id,
          race_distance: plan.race_distance,
          goal_time: plan.goal_time,
          training_days: plan.training_days,
          start_date: plan.start_date,
          content: validatedRevised,
        };
        const { data: inserted } = await supabase.from("training_plans").insert(newPlan).select("id").maybeSingle();
        if (inserted?.id) {
          pushUndoEntry(inserted.id, plan.content!, "full plan rewrite");
        }
        finishWith("✅ Done — your plan has been updated. Use the **Undo** button at the top of the Training Plan to revert.");
        toast({ title: "Plan updated", description: "AI coach applied the change." });
      },
      onError: (err) => finishWith(`⚠️ Couldn't apply the change: ${err}`),
    });
  }, [loading, toast]);

  /**
   * Deterministic single-day actions (Skip / Move to tomorrow / Replace
   * with recovery) used when the coach flags a session due to illness, low
   * readiness, or injury. Each action edits the plan directly so the user
   * sees exactly what will happen before they tap.
   */
  const applyDayAction = useCallback(
    async (
      dateUk: string,
      action: "skip" | "move" | "recovery" | "move-compressed" | "move-shift-race",
    ) => {
      if (loading) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        toast({ title: "Please sign in", variant: "destructive" });
        return;
      }
      const { data: plan } = await supabase
        .from("training_plans")
        .select("id, content, race_date")
        .eq("user_id", session.user.id)
        .eq("archived", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!plan?.content) {
        toast({ title: "No active plan", variant: "destructive" });
        return;
      }

      // Race-date conflict gate: when the user taps the plain "move" button
      // and the cascade would push sessions past race day, surface the three
      // resolution options in chat instead of writing silently.
      if (action === "move" && plan.race_date) {
        const preview = previewMoveCascade(plan.content, dateUk);
        if (preview) {
          const conflict = detectRaceDateConflict(preview, plan.race_date);
          if (conflict.hasConflict) {
            const targetLabel = `${["Sun","Mon","Tues","Wed","Thurs","Fri","Sat"][preview.targetDate.getDay()]} ${String(preview.targetDate.getDate()).padStart(2,"0")}/${String(preview.targetDate.getMonth()+1).padStart(2,"0")}`;
            const raceLabel = formatRaceDateLabel(plan.race_date);
            const msg =
              `⚠️ Moving this session to **${targetLabel}** would push ` +
              `**${conflict.overflowCount} later session${conflict.overflowCount === 1 ? "" : "s"} past your race date of ${raceLabel}**.\n\n` +
              `Here are your options:\n\n[[ACTION:race-conflict:${dateUk}]]`;
            setMessages((prev) => [...prev, { role: "assistant", content: msg }]);
            return;
          }
        }
      }

      let result: { updatedPlan: string; summary: string } | null = null;
      let newRaceDate: string | null = null;
      if (action === "skip") result = applySkipSession(plan.content, dateUk);
      else if (action === "recovery") result = applyReplaceWithRecovery(plan.content, dateUk);
      else if (action === "move") result = applyMoveSession(plan.content, dateUk);
      else if (action === "move-compressed" && plan.race_date) {
        result = applyMoveCompressed(plan.content, dateUk, plan.race_date);
      } else if (action === "move-shift-race" && plan.race_date) {
        const out = applyMoveAndShiftRace(plan.content, dateUk, plan.race_date);
        if (out) {
          result = out.result;
          newRaceDate = out.newRaceDateIso;
        }
      }

      if (!result) {
        toast({
          title: "Couldn't update plan",
          description: `No session found on ${dateUk}.`,
          variant: "destructive",
        });
        return;
      }

      const validated = enforceAndLog(result.updatedPlan, `chat day action: ${action}`).content;
      pushUndoEntry(
        plan.id,
        plan.content,
        `${dateUk} session (${action})`,
        newRaceDate ? { prevRaceDate: plan.race_date } : undefined,
      );
      const updatePayload: { content: string; race_date?: string } = { content: validated };
      if (newRaceDate) updatePayload.race_date = newRaceDate;
      const { error } = await supabase
        .from("training_plans")
        .update(updatePayload)
        .eq("id", plan.id);
      if (error) {
        toast({ title: "Couldn't save change", description: error.message, variant: "destructive" });
        return;
      }
      setLastUndo({ planId: plan.id, prevContent: plan.content, prevRaceDate: plan.race_date, dateUk });
      setActivePlanContent(validated);
      if (newRaceDate) setActivePlanRaceDate(newRaceDate);
      const raceNote = newRaceDate
        ? ` Race date shifted to **${formatRaceDateLabel(newRaceDate)}**.`
        : "";
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `✅ ${result!.summary}${raceNote}\n\nUse the **Undo** button at the top of the Training Plan to revert.`,
        },
      ]);
      toast({ title: "Plan updated", description: result.summary });
    },
    [loading, toast],
  );

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

    // Ensure a thread exists for this conversation; create on first message.
    let activeThreadId = threadId;
    if (!activeThreadId) {
      const title = text.length > 60 ? text.slice(0, 57) + "…" : text;
      const { data: created, error: threadErr } = await supabase
        .from("chat_threads")
        .insert({ user_id: session.user.id, title })
        .select("id")
        .maybeSingle();
      if (threadErr || !created?.id) {
        console.error("Failed to create chat thread:", threadErr);
      } else {
        activeThreadId = created.id;
        setThreadId(created.id);
      }
    }

    // Persist the user message immediately.
    if (activeThreadId) {
      const { error: insErr } = await supabase.from("chat_messages").insert({
        thread_id: activeThreadId,
        user_id: session.user.id,
        role: "user",
        content: text,
      });
      if (insErr) console.error("Failed to save user message:", insErr);
    }

    // Two buffers:
    //   received → everything we've got back from the model so far
    //   typed    → what we've revealed to the user (chases `received`)
    // A typewriter loop reveals chars at a steady pace so even fast models
    // appear to "type" their answer in real time.
    let received = "";
    let typed = 0;
    let streamDone = false;
    let stopRequested = false;

    const controller = new AbortController();
    abortRef.current = controller;
    controller.signal.addEventListener("abort", () => { stopRequested = true; });

    const updateMessage = (visible: string) => {
      setMessages(prev => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: visible };
        return copy;
      });
    };

    // Add empty assistant placeholder up-front
    setMessages(prev => [...prev, { role: "assistant", content: "" }]);

    // Typewriter loop — runs in parallel with the network read.
    const typewriter = (async () => {
      // ~80 chars/sec — close to a fast reading pace, like ChatGPT.
      const CHARS_PER_TICK = 3;
      const TICK_MS = 25;
      while (true) {
        if (stopRequested) {
          // Reveal everything we've already received, then stop typing.
          if (typed < received.length) {
            typed = received.length;
            updateMessage(received);
          }
          return;
        }
        if (typed < received.length) {
          typed = Math.min(received.length, typed + CHARS_PER_TICK);
          updateMessage(received.slice(0, typed));
        } else if (streamDone) {
          // Caught up and stream finished.
          return;
        }
        await new Promise(r => setTimeout(r, TICK_MS));
      }
    })();

    try {
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          type: "chat",
          messages: text,
          history: [...messages, userMsg].slice(-20).map(m => ({ role: m.role, content: m.content })),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          geo: geoRef.current,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Request failed" }));
        toast({ title: "Chat error", description: err.error || `Error ${resp.status}`, variant: "destructive" });
        streamDone = true;
        await typewriter;
        setLoading(false);
        return;
      }

      if (!resp.body) { streamDone = true; await typewriter; setLoading(false); return; }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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
            if (content) received += content;
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }
      streamDone = true;
      await typewriter;

      const finalContent = isConcreteWorkoutEdit(stripActionMarkers(received))
        ? received
        : stripActionMarkers(received);
      updateMessage(finalContent);

      // Persist assistant reply + bump thread updated_at.
      if (activeThreadId && finalContent.trim()) {
        const { error: aErr } = await supabase.from("chat_messages").insert({
          thread_id: activeThreadId,
          user_id: session.user.id,
          role: "assistant",
          content: finalContent,
        });
        if (aErr) console.error("Failed to save assistant message:", aErr);
        await supabase.from("chat_threads")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", activeThreadId);
      }
    } catch (e: unknown) {
      streamDone = true;
      const isAbort = (e as { name?: string })?.name === "AbortError";
      await typewriter;
      let stoppedContent = "";
      if (isAbort) {
        stoppedContent = (received || "").trim() + "\n\n_⏹ Stopped_";
        setMessages(prev => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") {
            copy[copy.length - 1] = { role: "assistant", content: stoppedContent };
          }
          return copy;
        });
      } else {
        const message = e instanceof Error ? e.message : "Request failed";
        toast({ title: "Chat failed", description: message, variant: "destructive" });
      }
      // Persist whatever the user sees (stopped or partial).
      if (isAbort && activeThreadId && stoppedContent.trim()) {
        const { error: sErr } = await supabase.from("chat_messages").insert({
          thread_id: activeThreadId,
          user_id: session.user.id,
          role: "assistant",
          content: stoppedContent,
        });
        if (sErr) console.error("Failed to save stopped message:", sErr);
        await supabase.from("chat_threads")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", activeThreadId);
      }
    }

    abortRef.current = null;
    setLoading(false);
  }, [input, loading, messages, toast, threadId]);

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        size="lg"
        className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50 rounded-full h-14 w-14 shadow-lg p-0"
      >
        <MessageCircle className="w-6 h-6" />
      </Button>
    );
  }

  return (
    <Card className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50 w-[calc(100vw-2rem)] sm:w-[400px] h-[500px] max-h-[calc(100vh-6rem)] shadow-2xl flex flex-col">
      <CardHeader className="p-3 border-b flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-primary" />
          Scarpers Chat
        </CardTitle>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={startNewChat}
            disabled={loading}
            title="New chat"
          >
            <Plus className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}>
            <X className="w-4 h-4" />
          </Button>
        </div>
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
            
            const dayMatch = msg.role === "assistant"
              ? msg.content.match(/\[\[ACTION:day:(\d{1,2}\/\d{1,2}\/\d{4})\]\]/)
              : null;
            const conflictMatch = msg.role === "assistant"
              ? msg.content.match(/\[\[ACTION:race-conflict:(\d{1,2}\/\d{1,2}\/\d{4})\]\]/)
              : null;
            const planMatch = msg.role === "assistant"
              ? /\[\[ACTION:plan\]\]/.test(msg.content)
              : false;
            // Backwards-compatible legacy marker.
            const legacyMatch = msg.role === "assistant"
              ? /\[\[ACTION:recommendation\]\]/.test(msg.content)
              : false;
            const hasUndo = msg.role === "assistant" && /\[\[UNDO\]\]/.test(msg.content);
            const hasAction = !!dayMatch || planMatch || legacyMatch || !!conflictMatch;
            const cleaned = (hasAction || hasUndo)
              ? msg.content
                  .replace(ACTION_MARKER_REGEX, "")
                  .replace(/\[\[UNDO\]\]/g, "")
                  .trim()
              : msg.content;
            const isLastAssistant = msg.role === "assistant" && i === messages.length - 1;
            const isConcrete = isConcreteWorkoutEdit(cleaned);
            const showActions = !conflictMatch && hasAction && isConcrete && isLastAssistant && !loading;
            const showConflict = !!conflictMatch && isLastAssistant && !loading;
            const showNoChange = !conflictMatch && hasAction && !isConcrete && isLastAssistant && !loading;
            const showUndo = hasUndo && isLastAssistant && !loading && !!lastUndo;
            const scope: { kind: "day"; dateUk: string } | { kind: "plan" } = dayMatch
              ? { kind: "day", dateUk: dayMatch[1] }
              : { kind: "plan" };
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
                  {showActions && scope.kind === "day" && (
                    <div className="mt-3 space-y-2">
                      <p className="text-[11px] text-muted-foreground">
                        Affects only your <strong>{scope.dateUk}</strong> session. Pick exactly what you'd like to do:
                      </p>
                      <div className="flex flex-col gap-1.5">
                        <Button
                          size="sm"
                          className="h-8 text-xs justify-start bg-primary"
                          disabled={loading}
                          onClick={() => applyChange(cleaned, scope)}
                        >
                          ✨ Apply suggested workout
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs justify-start"
                          disabled={loading}
                          onClick={() => applyDayAction(scope.dateUk, "skip")}
                        >
                          Skip this session
                        </Button>
                        {(() => {
                          const sourceMatch = scope.dateUk.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                          const sourceDate = sourceMatch
                            ? new Date(Number(sourceMatch[3]), Number(sourceMatch[2]) - 1, Number(sourceMatch[1]))
                            : null;
                          const targetDate = activePlanContent
                            ? getMoveTargetDate(activePlanContent, scope.dateUk)
                            : null;
                          const label = sourceDate && targetDate
                            ? `Move to ${formatMoveTargetLabel(sourceDate, targetDate)}`
                            : "Move to next training day";
                          return (
                            <Button
                              size="sm"
                              className="h-8 text-xs justify-start"
                              disabled={loading}
                              onClick={() => applyDayAction(scope.dateUk, "move")}
                            >
                              {label}
                            </Button>
                          );
                        })()}
                        <Button
                          size="sm"
                          className="h-8 text-xs justify-start"
                          disabled={loading}
                          onClick={() => applyDayAction(scope.dateUk, "recovery")}
                        >
                          Replace with 20-min recovery walk
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs justify-start"
                          disabled={loading}
                          onClick={() => {
                            setMessages(prev => [...prev, { role: "assistant", content: "Got it — keeping the session as planned." }]);
                          }}
                        >
                          Keep as it is
                        </Button>
                      </div>
                    </div>
                  )}
                  {showConflict && conflictMatch && activePlanRaceDate && (() => {
                    const dateUk = conflictMatch[1];
                    const raceIso = activePlanRaceDate;
                    const raceMatch = raceIso.match(/^(\d{4})-(\d{2})-(\d{2})/);
                    const raceDate = raceMatch
                      ? new Date(Number(raceMatch[1]), Number(raceMatch[2]) - 1, Number(raceMatch[3]))
                      : null;
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const daysToRace = raceDate
                      ? Math.round((raceDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
                      : Infinity;
                    const recommended: "compress" | "skip" = daysToRace > 28 ? "compress" : "skip";
                    // Preview the shifted race date label for Option 2.
                    let shiftedRaceLabel = "";
                    if (activePlanContent) {
                      const preview = previewMoveCascade(activePlanContent, dateUk);
                      if (preview) {
                        const conflict = detectRaceDateConflict(preview, raceIso);
                        if (raceDate) {
                          const newRace = new Date(raceDate);
                          newRace.setDate(newRace.getDate() + Math.max(1, conflict.cascadeDays));
                          shiftedRaceLabel = formatRaceDateLabel(
                            `${newRace.getFullYear()}-${String(newRace.getMonth() + 1).padStart(2, "0")}-${String(newRace.getDate()).padStart(2, "0")}`,
                          );
                        }
                      }
                    }
                    const RecChip = () => (
                      <span className="ml-2 text-[10px] uppercase tracking-wide bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                        Recommended
                      </span>
                    );
                    return (
                      <div className="mt-3 space-y-2">
                        <div className="flex flex-col gap-1.5">
                          <Button
                            size="sm"
                            className="h-auto min-h-8 text-xs justify-between text-left py-2"
                            disabled={loading}
                            onClick={() => applyDayAction(dateUk, "move-compressed")}
                          >
                            <span>Stick to race date (compress sessions)</span>
                            {recommended === "compress" && <RecChip />}
                          </Button>
                          <Button
                            size="sm"
                            className="h-auto min-h-8 text-xs justify-start text-left py-2"
                            disabled={loading}
                            onClick={() => applyDayAction(dateUk, "move-shift-race")}
                          >
                            {shiftedRaceLabel
                              ? `Move race date to ${shiftedRaceLabel}`
                              : "Move race date forward"}
                          </Button>
                          <Button
                            size="sm"
                            className="h-auto min-h-8 text-xs justify-between text-left py-2"
                            disabled={loading}
                            onClick={() => applyDayAction(dateUk, "skip")}
                          >
                            <span>Skip this session (keep plan & race date)</span>
                            {recommended === "skip" && <RecChip />}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs justify-start"
                            disabled={loading}
                            onClick={() => {
                              setMessages(prev => [...prev, { role: "assistant", content: "Got it — keeping the session as planned." }]);
                            }}
                          >
                            Keep as it is
                          </Button>
                        </div>
                      </div>
                    );
                  })()}
                  {showActions && scope.kind === "plan" && (
                    <div className="mt-3 space-y-2">
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="flex-1 h-8 text-xs"
                          disabled={loading}
                          onClick={() => applyChange(cleaned, scope)}
                        >
                          Apply this change to my plan
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 h-8 text-xs"
                          disabled={loading}
                          onClick={() => {
                            setMessages(prev => [...prev, { role: "assistant", content: "Got it — keeping the plan as it is." }]);
                          }}
                        >
                          Keep as it is
                        </Button>
                      </div>
                    </div>
                  )}
                  {showNoChange && (
                    <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-background/40 px-2.5 py-1.5">
                      <Check className="w-3.5 h-3.5 text-primary" />
                      <span className="text-[11px] font-medium text-muted-foreground">
                        No changes needed
                      </span>
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
          {loading ? (
            <Button size="icon" variant="destructive" onClick={stopReply} title="Stop reply">
              <Square className="w-4 h-4" />
            </Button>
          ) : (
            <Button size="icon" onClick={sendMessage} disabled={!input.trim()}>
              <Send className="w-4 h-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default AIChatbot;

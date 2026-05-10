// Shared AI provider abstraction.
// Reads global provider setting from public.app_settings and routes to
// either the Lovable AI Gateway or Anthropic Claude. Returns responses
// in OpenAI-compatible shape so callers don't need to change.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export interface AISettings {
  provider: "lovable" | "claude";
  claude_model: string;
}

export async function getAISettings(): Promise<AISettings> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !key) return { provider: "lovable", claude_model: "claude-haiku-4-5" };
    const sb = createClient(url, key);
    const { data } = await sb.from("app_settings").select("ai_provider, claude_model").eq("id", 1).maybeSingle();
    if (!data) return { provider: "lovable", claude_model: "claude-haiku-4-5" };
    return {
      provider: (data.ai_provider === "claude" ? "claude" : "lovable"),
      claude_model: data.claude_model || "claude-haiku-4-5",
    };
  } catch {
    return { provider: "lovable", claude_model: "claude-haiku-4-5" };
  }
}

interface AICallOpts {
  messages: ChatMessage[];
  stream?: boolean;
  lovableModel?: string; // model used when provider=lovable
  maxTokens?: number;
  // Optional logging metadata
  userId?: string;
  label?: string;
}

// ----- Pricing (USD per 1k tokens) -----
// Rough public pricing; used only for monitoring/admin display.
const PRICING: Record<string, { in: number; out: number }> = {
  // Anthropic
  "claude-haiku-4-5": { in: 0.001, out: 0.005 },
  "claude-sonnet-4-5": { in: 0.003, out: 0.015 },
  "claude-opus-4-5": { in: 0.015, out: 0.075 },
  // Lovable Gateway models — gateway is included in Lovable plan; mark as 0 by default
  "google/gemini-3-flash-preview": { in: 0, out: 0 },
  "google/gemini-2.5-flash": { in: 0, out: 0 },
  "google/gemini-2.5-pro": { in: 0, out: 0 },
};

function estimateCost(model: string | undefined, inTok: number, outTok: number): number {
  if (!model) return 0;
  const p = PRICING[model];
  if (!p) {
    // fallback: small Anthropic-ish rate for unknown claude models
    if (model.includes("claude")) return (inTok / 1000) * 0.003 + (outTok / 1000) * 0.015;
    return 0;
  }
  return (inTok / 1000) * p.in + (outTok / 1000) * p.out;
}

function approxTokens(text: string): number {
  // ~4 chars per token rough heuristic
  return Math.ceil((text || "").length / 4);
}

async function logUsage(row: {
  user_id?: string;
  provider: string;
  model?: string;
  label?: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  status: number;
  streamed: boolean;
}): Promise<void> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    const sb = createClient(url, key);
    const total = row.input_tokens + row.output_tokens;
    const cost = estimateCost(row.model, row.input_tokens, row.output_tokens);
    await sb.from("ai_usage_log").insert({
      user_id: row.user_id ?? null,
      provider: row.provider,
      model: row.model ?? null,
      label: row.label ?? null,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      total_tokens: total,
      estimated_cost_usd: cost,
      latency_ms: row.latency_ms,
      status: row.status,
      streamed: row.streamed,
    });
  } catch (e) {
    console.error("ai_usage_log insert failed:", e);
  }
}

/**
 * Calls the configured AI provider. Returns a fetch Response.
 * - For stream=true: response.body is an SSE stream in OpenAI delta format.
 * - For stream=false: JSON body shaped { choices: [{ message: { content } }] }.
 * Errors propagate via response.status (429/402 preserved when possible).
 */
export async function callAI(opts: AICallOpts): Promise<Response> {
  const settings = await getAISettings();
  const stream = !!opts.stream;
  const maxTokens = opts.maxTokens ?? 4096;
  const startedAt = Date.now();
  const inputText = opts.messages.map(m => m.content).join("\n");
  const inputTokenEstimate = approxTokens(inputText);

  if (settings.provider === "claude") {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
    const systemParts = opts.messages.filter(m => m.role === "system").map(m => m.content);
    const convo = opts.messages
      .filter(m => m.role !== "system")
      .map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

    const body: Record<string, unknown> = {
      model: settings.claude_model,
      max_tokens: maxTokens,
      messages: convo,
      stream,
    };
    if (systemParts.length) body.system = systemParts.join("\n\n");

    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
        ...(stream ? { "Accept": "text/event-stream" } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("Anthropic error:", resp.status, text);
      logUsage({
        user_id: opts.userId, provider: "claude", model: settings.claude_model, label: opts.label,
        input_tokens: inputTokenEstimate, output_tokens: 0,
        latency_ms: Date.now() - startedAt, status: resp.status, streamed: stream,
      });
      return new Response(JSON.stringify({ error: "Anthropic error", detail: text }), {
        status: resp.status, headers: { "Content-Type": "application/json" },
      });
    }

    if (!stream) {
      const data = await resp.json();
      const content = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      const usage = data.usage || {};
      logUsage({
        user_id: opts.userId, provider: "claude", model: settings.claude_model, label: opts.label,
        input_tokens: usage.input_tokens ?? inputTokenEstimate,
        output_tokens: usage.output_tokens ?? approxTokens(content),
        latency_ms: Date.now() - startedAt, status: 200, streamed: false,
      });
      return new Response(
        JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Convert Anthropic SSE -> OpenAI-compatible delta SSE, capturing usage
    const openaiStream = anthropicToOpenAIStream(resp.body!, (usage) => {
      logUsage({
        user_id: opts.userId, provider: "claude", model: settings.claude_model, label: opts.label,
        input_tokens: usage.input_tokens ?? inputTokenEstimate,
        output_tokens: usage.output_tokens ?? 0,
        latency_ms: Date.now() - startedAt, status: 200, streamed: true,
      });
    });
    return new Response(openaiStream, {
      status: 200, headers: { "Content-Type": "text/event-stream" },
    });
  }

  // Lovable provider
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (!lovableKey) {
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  const model = opts.lovableModel || "google/gemini-3-flash-preview";
  const resp = await fetch(LOVABLE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "Content-Type": "application/json",
      ...(stream ? { "Accept": "text/event-stream" } : {}),
    },
    body: JSON.stringify({
      model,
      messages: opts.messages,
      stream,
      max_tokens: maxTokens,
    }),
  });

  if (!resp.ok) {
    logUsage({
      user_id: opts.userId, provider: "lovable", model, label: opts.label,
      input_tokens: inputTokenEstimate, output_tokens: 0,
      latency_ms: Date.now() - startedAt, status: resp.status, streamed: stream,
    });
    return resp;
  }

  if (!stream) {
    const data = await resp.json();
    const usage = data.usage || {};
    const content = data?.choices?.[0]?.message?.content || "";
    logUsage({
      user_id: opts.userId, provider: "lovable", model, label: opts.label,
      input_tokens: usage.prompt_tokens ?? inputTokenEstimate,
      output_tokens: usage.completion_tokens ?? approxTokens(content),
      latency_ms: Date.now() - startedAt, status: 200, streamed: false,
    });
    return new Response(JSON.stringify(data), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  // Stream: pass-through but tally output chars to estimate output tokens
  const passthrough = openaiStreamWithUsage(resp.body!, (outChars, usage) => {
    logUsage({
      user_id: opts.userId, provider: "lovable", model, label: opts.label,
      input_tokens: usage?.prompt_tokens ?? inputTokenEstimate,
      output_tokens: usage?.completion_tokens ?? Math.ceil(outChars / 4),
      latency_ms: Date.now() - startedAt, status: 200, streamed: true,
    });
  });
  return new Response(passthrough, {
    status: 200, headers: { "Content-Type": "text/event-stream" },
  });
}

function anthropicToOpenAIStream(
  input: ReadableStream<Uint8Array>,
  onUsage: (usage: { input_tokens?: number; output_tokens?: number }) => void,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buf = "";
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  return new ReadableStream({
    async start(controller) {
      const reader = input.getReader();
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, idx).replace(/\r$/, "");
            buf = buf.slice(idx + 1);
            if (!line.startsWith("data: ")) continue;
            const json = line.slice(6).trim();
            if (!json) continue;
            try {
              const evt = JSON.parse(json);
              if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                send({ choices: [{ delta: { content: evt.delta.text } }] });
              } else if (evt.type === "message_start" && evt.message?.usage) {
                inputTokens = evt.message.usage.input_tokens;
              } else if (evt.type === "message_delta" && evt.usage) {
                outputTokens = evt.usage.output_tokens;
              } else if (evt.type === "message_stop") {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              }
            } catch { /* ignore partial */ }
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (e) {
        console.error("anthropic stream error:", e);
      } finally {
        try { onUsage({ input_tokens: inputTokens, output_tokens: outputTokens }); } catch {}
        controller.close();
      }
    },
  });
}

function openaiStreamWithUsage(
  input: ReadableStream<Uint8Array>,
  onDone: (outChars: number, usage?: { prompt_tokens?: number; completion_tokens?: number }) => void,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buf = "";
  let outChars = 0;
  let usage: any = undefined;
  return new ReadableStream({
    async start(controller) {
      const reader = input.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          // pass-through
          controller.enqueue(value);
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, idx).replace(/\r$/, "");
            buf = buf.slice(idx + 1);
            if (!line.startsWith("data: ")) continue;
            const json = line.slice(6).trim();
            if (!json || json === "[DONE]") continue;
            try {
              const evt = JSON.parse(json);
              const delta = evt?.choices?.[0]?.delta?.content;
              if (typeof delta === "string") outChars += delta.length;
              if (evt?.usage) usage = evt.usage;
            } catch { /* ignore */ }
          }
        }
      } catch (e) {
        console.error("lovable stream tap error:", e);
      } finally {
        try { onDone(outChars, usage); } catch {}
        controller.close();
      }
    },
  });
}

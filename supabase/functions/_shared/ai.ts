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

  if (settings.provider === "claude") {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
    // Split system messages
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
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("Anthropic error:", resp.status, text);
      return new Response(JSON.stringify({ error: "Anthropic error", detail: text }), {
        status: resp.status, headers: { "Content-Type": "application/json" },
      });
    }

    if (!stream) {
      const data = await resp.json();
      const content = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      return new Response(
        JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Convert Anthropic SSE -> OpenAI-compatible delta SSE
    const openaiStream = anthropicToOpenAIStream(resp.body!);
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
  return await fetch(LOVABLE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.lovableModel || "google/gemini-3-flash-preview",
      messages: opts.messages,
      stream,
    }),
  });
}

function anthropicToOpenAIStream(input: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buf = "";
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
        controller.close();
      }
    },
  });
}

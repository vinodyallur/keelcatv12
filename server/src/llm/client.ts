// Minimal OpenAI-compatible chat client. Works with OpenRouter and Google
// Gemini (OpenAI-compat endpoint), or any custom base URL. Used only to parse
// human changelog text into a precise, structured change spec — never to
// silently rewrite code without validation.

import { getConfig, getLlmKey } from "../config/store.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function resolveBaseUrl(): string {
  const { llm } = getConfig();
  if (llm.baseUrl) return llm.baseUrl.replace(/\/$/, "");
  switch (llm.provider) {
    case "gemini":
      return "https://generativelanguage.googleapis.com/v1beta/openai";
    case "openrouter":
    default:
      return "https://openrouter.ai/api/v1";
  }
}

export function llmConfigured(): boolean {
  const { llm } = getConfig();
  return llm.provider !== "disabled" && Boolean(getLlmKey());
}

export interface ChatOptions {
  messages: ChatMessage[];
  temperature?: number;
  jsonMode?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
}

export async function chat(opts: ChatOptions): Promise<string> {
  const key = getLlmKey();
  if (!key) throw new Error("No LLM API key configured. Add one in Settings.");
  const { llm } = getConfig();
  const url = `${resolveBaseUrl()}/chat/completions`;

  const body: Record<string, unknown> = {
    model: llm.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0,
    max_tokens: opts.maxTokens ?? 2048,
  };
  if (opts.jsonMode) body.response_format = { type: "json_object" };

  // Hard timeout so a slow/flaky model can never hang an entire multi-repo run.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        // OpenRouter attribution headers (harmless elsewhere).
        "HTTP-Referer": "https://apisteward.local",
        "X-Title": "KeelCat",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("LLM request timed out.");
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`LLM request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`LLM returned non-JSON response: ${text.slice(0, 200)}`);
  }
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("LLM response missing message content.");
  }
  return content;
}

/** Robustly extract the first JSON object/array from a model response. */
export function extractJson<T = unknown>(raw: string): T {
  const trimmed = raw.trim();
  // Strip ```json fences if present.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    // Find the first balanced { ... } or [ ... ].
    const start = candidate.search(/[{[]/);
    if (start >= 0) {
      const open = candidate[start];
      const close = open === "{" ? "}" : "]";
      let depth = 0;
      for (let i = start; i < candidate.length; i++) {
        if (candidate[i] === open) depth++;
        else if (candidate[i] === close) {
          depth--;
          if (depth === 0) {
            return JSON.parse(candidate.slice(start, i + 1)) as T;
          }
        }
      }
    }
    throw new Error("Could not parse JSON from LLM response.");
  }
}

/** Quick connectivity check used by the Settings "Test" button. */
export async function pingLlm(): Promise<{ ok: boolean; model: string; sample: string }> {
  const { llm } = getConfig();
  const out = await chat({
    messages: [{ role: "user", content: "Reply with exactly the word: ok" }],
    maxTokens: 10,
  });
  return { ok: true, model: llm.model, sample: out.trim().slice(0, 40) };
}

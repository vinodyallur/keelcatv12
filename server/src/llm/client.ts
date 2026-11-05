// Minimal OpenAI-compatible chat client for Meta models (Muse Spark and Llama via
// OpenRouter by default, or any OpenAI-compatible host serving Meta open weights).
// Turns changelog text into a structured change spec and drafts edits only where a
// deterministic rewrite is impossible — never silently rewrites code without validation.

import { getConfig, getLlmKey } from "../config/store.js";
import { defaultLlmFor, recordDefaultLlmUse } from "../config/default-llm.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ResolvedLlm {
  baseUrl: string;
  model: string;
  key: string;
  /** The admin's default: counts toward its daily limits and hides upstream details. */
  shared: boolean;
}

const META_OPENROUTER_URL = "https://openrouter.ai/api/v1";

function baseUrlFor(baseUrl?: string): string {
  return baseUrl ? baseUrl.replace(/\/$/, "") : META_OPENROUTER_URL;
}

/**
 * The workspace's own provider wins. Otherwise the admin's default is used as a
 * whole, so its key is never sent to a URL or model chosen by the workspace.
 */
export function resolveLlm(): ResolvedLlm | null {
  const { llm } = getConfig();
  if (llm.provider === "disabled") return null;
  const own = getLlmKey();
  if (own) return { baseUrl: baseUrlFor(llm.baseUrl), model: llm.model, key: own, shared: false };
  const fallback = defaultLlmFor();
  return fallback ? { ...fallback, shared: true } : null;
}

export function llmConfigured(): boolean {
  return resolveLlm() !== null;
}

export interface ChatOptions {
  messages: ChatMessage[];
  temperature?: number;
  jsonMode?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
}

export async function chat(opts: ChatOptions): Promise<string> {
  const llm = resolveLlm();
  if (!llm) throw new Error("No LLM configured. Add an API key in Connect.");
  if (llm.shared) recordDefaultLlmUse();
  return chatWith(llm, opts);
}

// Reasoning models (e.g. Meta Muse) spend part of max_tokens thinking before they answer.
const MIN_OPENROUTER_TOKENS = 4096;

export async function chatWith(llm: ResolvedLlm, opts: ChatOptions): Promise<string> {
  const url = `${llm.baseUrl}/chat/completions`;
  const onOpenRouter = llm.baseUrl.startsWith(META_OPENROUTER_URL);
  const maxTokens = opts.maxTokens ?? 2048;

  const body: Record<string, unknown> = {
    model: llm.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0,
    max_tokens: onOpenRouter ? Math.max(maxTokens, MIN_OPENROUTER_TOKENS) : maxTokens,
  };
  if (onOpenRouter) body.reasoning = { effort: "low", exclude: true };
  if (opts.jsonMode) body.response_format = { type: "json_object" };

  // Hard timeout so a slow/flaky model can never hang an entire multi-repo run.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? (onOpenRouter ? 60_000 : 30_000));
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${llm.key}`,
        // OpenRouter attribution headers (harmless elsewhere).
        "HTTP-Referer": "https://apisteward.local",
        "X-Title": "KeelCat",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (llm.shared) throw new Error("KeelCat AI is unavailable right now.");
    if ((e as Error).name === "AbortError") throw new Error("LLM request timed out.");
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    if (llm.shared) throw new Error(`KeelCat AI request failed (${res.status}).`);
    throw new Error(`LLM request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    if (llm.shared) throw new Error("KeelCat AI returned an unreadable response.");
    throw new Error(`LLM returned non-JSON response: ${text.slice(0, 200)}`);
  }
  const choice = json?.choices?.[0];
  const raw = choice?.message?.content;
  // Some providers return content as an array of parts instead of a string.
  const content =
    typeof raw === "string"
      ? raw
      : Array.isArray(raw)
        ? raw.map((p: { text?: unknown }) => (typeof p?.text === "string" ? p.text : "")).join("")
        : "";
  if (!content.trim()) {
    if (choice?.finish_reason === "length") {
      throw new Error("The model used its whole token budget thinking and returned no answer. Try again, or pick a lighter model.");
    }
    throw new Error("The model returned an empty answer.");
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
  const llm = resolveLlm();
  const out = await chat({
    messages: [{ role: "user", content: "Reply with exactly the word: ok" }],
    maxTokens: 512,
  });
  return { ok: true, model: llm?.shared ? "KeelCat AI" : (llm?.model ?? ""), sample: out.trim().slice(0, 40) };
}

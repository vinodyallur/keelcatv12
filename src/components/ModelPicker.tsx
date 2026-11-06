import { useEffect, useState } from "react";
import { api, type CatalogModel } from "../api";
import { Dropdown } from "./ui";

export const META_API_URL = "https://api.meta.ai/v1";
export const OPENROUTER_URL = "https://openrouter.ai/api/v1";

export interface Host {
  label: string;
  baseUrl?: string;
  defaultModel?: string;
  keyHint: string;
  kind: "local" | "cloud" | "none";
  note?: string;
}

export const HOSTS: Record<string, Host> = {
  meta: {
    label: "Meta Model API (Muse)",
    baseUrl: META_API_URL,
    defaultModel: "muse-spark-1.3",
    keyHint: "from dev.meta.ai → API keys",
    kind: "cloud",
    note: "Prices are USD per 1M tokens, input / output. Muse Wonder is the most capable; Muse Spark 1.3 is the best value. Contributor models are much cheaper, but Meta may use the prompts to train its models.",
  },
  openrouter: {
    label: "OpenRouter (Meta, Google, NVIDIA and more)",
    baseUrl: OPENROUTER_URL,
    defaultModel: "meta/muse-spark-1.3",
    keyHint: "starts with sk-or-…",
    kind: "cloud",
    note: "Live list of every OpenRouter text model, grouped by vendor, priciest (usually strongest) first. Prices are USD per 1M tokens, input / output.",
  },
  custom: {
    label: "Other OpenAI-compatible host",
    keyHint: "the host's API key",
    kind: "cloud",
    note: "Use the OpenAI-compatible base URL of the host serving your model, for example Fireworks, Together, Baseten or Modal. This server must be able to reach it.",
  },
  ollama: {
    label: "Ollama (local server)",
    baseUrl: "http://127.0.0.1:11434/v1",
    defaultModel: "muse-glimmer:30b",
    keyHint: "local server — no key needed",
    kind: "local",
    note: "Free and private: runs on your own machine. Largest models first. Run ollama pull <model ID> before using one.",
  },
  "on-device": { label: "On-device (phone)", defaultModel: "on-device model", keyHint: "runs on this phone — no key", kind: "local" },
  disabled: { label: "Disabled (manual changes only)", keyHint: "no key needed", kind: "none" },
};

export function hostOf(baseUrl: string): "meta" | "openrouter" | "custom" {
  if (baseUrl.startsWith(META_API_URL)) return "meta";
  if (baseUrl.startsWith(OPENROUTER_URL)) return "openrouter";
  return "custom";
}

interface Choice {
  id: string;
  label: string;
  price: string;
}
interface Family {
  name: string;
  models: Choice[];
}

const SPARK = "$1.25 / $4.25";
const CONTRIBUTOR = "$0.10 / $0.20, Meta may train on prompts";

// Meta Model API text models, strongest first (prices from dev.meta.ai pricing).
const META_API: Family[] = [
  { name: "Muse Wonder", models: [{ id: "muse-wonder-1.0", label: "Muse Wonder 1.0", price: "$4 / $20" }] },
  {
    name: "Muse Spark",
    models: [
      { id: "muse-spark-1.3", label: "Muse Spark 1.3", price: SPARK },
      { id: "muse-spark-1.3-contributor", label: "Muse Spark 1.3 Contributor", price: CONTRIBUTOR },
      { id: "muse-spark-1.2", label: "Muse Spark 1.2", price: SPARK },
      { id: "muse-spark-1.2-contributor", label: "Muse Spark 1.2 Contributor", price: CONTRIBUTOR },
      { id: "muse-spark-1.1", label: "Muse Spark 1.1", price: SPARK },
    ],
  },
];

const local = (id: string, label: string): Choice => ({ id, label, price: "free, runs locally" });
const OLLAMA: Family[] = [
  {
    name: "Meta",
    models: [
      local("llama4:128x17b", "Llama 4 Maverick (400B MoE)"),
      local("llama4:16x17b", "Llama 4 Scout (109B MoE)"),
      local("llama3.3:70b", "Llama 3.3 70B"),
      local("muse-glimmer:30b", "Muse Glimmer 30B"),
      local("llama3.1:8b", "Llama 3.1 8B"),
      local("llama3.2:3b", "Llama 3.2 3B"),
      local("llama3.2:1b", "Llama 3.2 1B"),
    ],
  },
  {
    name: "DeepSeek",
    models: [
      local("deepseek-v3.1:671b", "DeepSeek V3.1 671B"),
      local("deepseek-r1:671b", "DeepSeek R1 671B"),
      local("deepseek-r1:70b", "DeepSeek R1 70B"),
      local("deepseek-r1:32b", "DeepSeek R1 32B"),
      local("deepseek-r1:8b", "DeepSeek R1 8B"),
    ],
  },
  {
    name: "Google",
    models: [
      local("gemma4:31b", "Gemma 4 31B"),
      local("gemma3:27b", "Gemma 3 27B"),
      local("gemma4:26b", "Gemma 4 26B"),
      local("gemma4:12b", "Gemma 4 12B"),
      local("gemma3:12b", "Gemma 3 12B"),
      local("gemma4:e4b", "Gemma 4 E4B"),
      local("gemma3:4b", "Gemma 3 4B"),
      local("gemma4:e2b", "Gemma 4 E2B"),
      local("gemma3:1b", "Gemma 3 1B"),
    ],
  },
  {
    name: "Microsoft",
    models: [local("phi4-reasoning:14b", "Phi-4 Reasoning 14B"), local("phi4:14b", "Phi-4 14B"), local("phi4-mini:3.8b", "Phi-4 Mini 3.8B")],
  },
  {
    name: "Mistral",
    models: [
      local("mistral-medium-3.5:128b", "Mistral Medium 3.5 128B"),
      local("devstral-small-2:24b", "Devstral Small 2 24B"),
      local("mistral-small3.2:24b", "Mistral Small 3.2 24B"),
      local("ministral-3:14b", "Ministral 3 14B"),
      local("ministral-3:8b", "Ministral 3 8B"),
    ],
  },
  {
    name: "NVIDIA",
    models: [
      local("nemotron-3.5-super:120b", "Nemotron 3.5 Super 120B"),
      local("nemotron-3.5-lightning:30b", "Nemotron 3.5 Lightning 30B"),
      local("nemotron-3-nano:30b", "Nemotron 3 Nano 30B"),
      local("nemotron-3-nano:4b", "Nemotron 3 Nano 4B"),
    ],
  },
  { name: "OpenAI", models: [local("gpt-oss:120b", "gpt-oss 120B"), local("gpt-oss:20b", "gpt-oss 20B")] },
  {
    name: "Qwen",
    models: [
      local("qwen3-coder:480b", "Qwen3 Coder 480B"),
      local("qwen3.6:35b", "Qwen3.6 35B"),
      local("qwen3-coder:30b", "Qwen3 Coder 30B"),
      local("qwen3.8:27b", "Qwen3.8 27B"),
      local("qwen3.6:27b", "Qwen3.6 27B"),
      local("qwen3:8b", "Qwen3 8B"),
    ],
  },
];

const STATIC_FAMILIES: Record<string, Family[]> = {
  meta: META_API,
  ollama: OLLAMA,
  "on-device": [{ name: "Built-in", models: [{ id: "on-device model", label: "On-device model", price: "free, on this phone" }] }],
};

const usd = (n: number) => `$${Number(n.toPrecision(3))}`;

function priceOf(m: CatalogModel): string {
  const price =
    m.input === null || m.output === null ? "price varies" : m.input + m.output === 0 ? "free" : `${usd(m.input)} / ${usd(m.output)}`;
  return m.retires ? `${price}, retires ${m.retires}` : price;
}

function byVendor(models: CatalogModel[]): Family[] {
  const groups = new Map<string, Choice[]>();
  for (const m of models) {
    const list = groups.get(m.vendor) ?? [];
    list.push({ id: m.id, label: m.name, price: priceOf(m) });
    groups.set(m.vendor, list);
  }
  return [...groups]
    .sort(([a], [b]) => Number(b === "Meta") - Number(a === "Meta") || a.localeCompare(b))
    .map(([name, models]) => ({ name, models }));
}

let openRouterFamilies: Promise<Family[]> | null = null;

function loadOpenRouter(): Promise<Family[]> {
  openRouterFamilies ??= api.llm.openRouterModels().then(byVendor, (e: Error) => {
    openRouterFamilies = null;
    throw e;
  });
  return openRouterFamilies;
}

/** Vendor (or model family) and model selects for a host; the family follows the chosen model ID. */
export function ModelSelects({
  host,
  model,
  onModel,
  labelClass,
}: {
  host: string;
  model: string;
  onModel: (id: string) => void;
  labelClass: string;
}) {
  const [openRouter, setOpenRouter] = useState<Family[] | string | null>(null);

  useEffect(() => {
    if (host !== "openrouter") return;
    let live = true;
    loadOpenRouter().then(
      (families) => live && setOpenRouter(families),
      (e: Error) => live && setOpenRouter(e.message),
    );
    return () => {
      live = false;
    };
  }, [host]);

  if (host === "custom") {
    return <p className="self-end text-[11px] text-content-faint">Type the model ID and the host's base URL below.</p>;
  }
  const families = host === "openrouter" ? (Array.isArray(openRouter) ? openRouter : []) : STATIC_FAMILIES[host];
  if (!families) return null;

  const family = families.find((f) => f.models.some((m) => m.id === model));
  const placeholder =
    host !== "openrouter" || Array.isArray(openRouter)
      ? "Custom model ID"
      : openRouter === null
        ? "Loading OpenRouter models…"
        : "List unavailable, type a model ID below";

  return (
    <>
      <Dropdown
        label="Vendor / family"
        labelClass={labelClass}
        value={family?.name ?? ""}
        options={families.map((f) => ({ value: f.name, label: f.name, hint: `${f.models.length} model${f.models.length === 1 ? "" : "s"}` }))}
        onChange={(name) => {
          const next = families.find((f) => f.name === name);
          if (next) onModel(next.models[0].id);
        }}
        placeholder={placeholder}
        disabled={!families.length}
      />
      <Dropdown
        label="Model · price per 1M tokens (in / out)"
        labelClass={labelClass}
        value={family ? model : ""}
        options={(family?.models ?? []).map((m) => ({ value: m.id, label: m.label, hint: m.price }))}
        onChange={onModel}
        placeholder={placeholder}
        disabled={!family}
      />
    </>
  );
}

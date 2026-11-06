// OpenRouter's public model list (no key needed), slimmed for the model picker and cached.

export interface CatalogModel {
  id: string;
  vendor: string;
  name: string;
  /** USD per 1M tokens; null when the price varies (routers). */
  input: number | null;
  output: number | null;
  retires?: string;
}

interface RawModel {
  id?: unknown;
  name?: unknown;
  created?: unknown;
  expiration_date?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
  architecture?: { output_modalities?: unknown };
}

const MODELS_URL = "https://openrouter.ai/api/v1/models";
const TTL_MS = 6 * 60 * 60 * 1000;

let cached: { at: number; models: CatalogModel[] } | null = null;
let pending: Promise<CatalogModel[]> | null = null;

function perMillion(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? Number((n * 1_000_000).toPrecision(4)) : null;
}

const slugOf = (id: string) => id.replace(/^~/, "").split("/")[0];

/** Text models that are not retired yet, priciest (usually strongest) first. */
export function toCatalog(raw: RawModel[], today = new Date().toISOString().slice(0, 10)): CatalogModel[] {
  // Most names read "Vendor: Model"; reuse that vendor for unprefixed models from the same slug.
  const vendorBySlug = new Map<string, string>();
  for (const m of raw) {
    const prefix = typeof m.name === "string" ? /^([^:]+): /.exec(m.name)?.[1] : undefined;
    if (prefix && typeof m.id === "string") vendorBySlug.set(slugOf(m.id), prefix);
  }

  const rows = raw.flatMap((m) => {
    if (typeof m.id !== "string") return [];
    const outputs = m.architecture?.output_modalities;
    if (Array.isArray(outputs) && !outputs.includes("text")) return [];
    const retires = typeof m.expiration_date === "string" ? m.expiration_date : undefined;
    if (retires && retires < today) return [];
    const name = typeof m.name === "string" ? m.name : m.id;
    const split = /^([^:]+): (.+)$/.exec(name);
    const model: CatalogModel = {
      id: m.id,
      vendor: split?.[1] ?? vendorBySlug.get(slugOf(m.id)) ?? slugOf(m.id),
      name: split?.[2] ?? name,
      input: perMillion(m.pricing?.prompt),
      output: perMillion(m.pricing?.completion),
      ...(retires ? { retires } : {}),
    };
    return [{ model, created: Number(m.created) || 0 }];
  });

  rows.sort(
    (a, b) =>
      (b.model.output ?? -1) - (a.model.output ?? -1) ||
      (b.model.input ?? -1) - (a.model.input ?? -1) ||
      b.created - a.created,
  );
  return rows.map((r) => r.model);
}

async function fetchModels(): Promise<CatalogModel[]> {
  const res = await fetch(MODELS_URL, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`OpenRouter model list failed (${res.status}).`);
  const json = (await res.json()) as { data?: unknown };
  const models = toCatalog(Array.isArray(json.data) ? (json.data as RawModel[]) : []);
  cached = { at: Date.now(), models };
  return models;
}

export async function openRouterModels(): Promise<CatalogModel[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.models;
  pending ??= fetchModels().finally(() => {
    pending = null;
  });
  try {
    return await pending;
  } catch (e) {
    if (cached) return cached.models;
    throw e;
  }
}

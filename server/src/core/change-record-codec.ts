import type { ChangeRecord, DeserializationError, ChangeType, MigrationHint } from "./types.js";

const CHANGE_TYPES: ChangeType[] = ["BREAKING", "DEPRECATION", "NEW_FEATURE"];
const MIGRATION_OPS = ["PARAM_RENAME", "PARAM_REMOVED", "PARAM_REQUIRED", "SYMBOL_RENAME", "METHOD_MOVED"];

/**
 * Canonical JSON serialization for Change Records (design R10).
 * Field ordering is stable and optional fields are handled canonically so that
 * serialize -> deserialize is a total round-trip for all valid records.
 */
export function serialize(record: ChangeRecord): string {
  const canonical: Record<string, unknown> = {
    changeRecordId: record.changeRecordId,
    providerId: record.providerId,
    symbol: record.symbol,
    changeType: record.changeType,
    sourceVersion: record.sourceVersion,
    detectedAt: record.detectedAt,
    sourceKind: record.sourceKind,
    summary: record.summary,
  };
  if (record.migration) {
    const m: Record<string, unknown> = {
      operation: record.migration.operation,
      from: record.migration.from,
    };
    if (record.migration.to !== undefined) m.to = record.migration.to;
    canonical.migration = m;
  }
  return JSON.stringify(canonical);
}

/** Throws on invalid input. */
export function deserialize(json: string): ChangeRecord {
  const result = tryDeserialize(json);
  if ("ok" in result && result.ok === false) {
    throw new Error(result.error);
  }
  return result as ChangeRecord;
}

/** Never throws. Returns a DeserializationError for malformed / schema-invalid payloads (R10.4). */
export function tryDeserialize(json: string): ChangeRecord | DeserializationError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `malformed JSON: ${(e as Error).message}`, raw: json };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "not a JSON object", raw: json };
  }
  const o = parsed as Record<string, unknown>;

  const strFields = ["changeRecordId", "providerId", "symbol", "sourceVersion", "detectedAt", "summary"];
  for (const f of strFields) {
    if (typeof o[f] !== "string") {
      return { ok: false, error: `field '${f}' must be a string`, raw: json };
    }
  }
  if (typeof o.changeType !== "string" || !CHANGE_TYPES.includes(o.changeType as ChangeType)) {
    return { ok: false, error: `invalid changeType: ${String(o.changeType)}`, raw: json };
  }
  if (o.sourceKind !== "OPENAPI" && o.sourceKind !== "SDK_RELEASE") {
    return { ok: false, error: `invalid sourceKind: ${String(o.sourceKind)}`, raw: json };
  }

  let migration: MigrationHint | undefined;
  if (o.migration !== undefined) {
    if (typeof o.migration !== "object" || o.migration === null) {
      return { ok: false, error: "migration must be an object", raw: json };
    }
    const m = o.migration as Record<string, unknown>;
    if (typeof m.operation !== "string" || !MIGRATION_OPS.includes(m.operation)) {
      return { ok: false, error: `invalid migration.operation: ${String(m.operation)}`, raw: json };
    }
    if (typeof m.from !== "string") {
      return { ok: false, error: "migration.from must be a string", raw: json };
    }
    if (m.to !== undefined && typeof m.to !== "string") {
      return { ok: false, error: "migration.to must be a string", raw: json };
    }
    migration = {
      operation: m.operation as MigrationHint["operation"],
      from: m.from,
      ...(m.to !== undefined ? { to: m.to as string } : {}),
    };
  }

  return {
    changeRecordId: o.changeRecordId as string,
    providerId: o.providerId as string,
    symbol: o.symbol as string,
    changeType: o.changeType as ChangeType,
    sourceVersion: o.sourceVersion as string,
    detectedAt: o.detectedAt as string,
    sourceKind: o.sourceKind as ChangeRecord["sourceKind"],
    summary: o.summary as string,
    ...(migration ? { migration } : {}),
  };
}

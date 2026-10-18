// Shared domain types for the KeelCat engine (mirrors design.md data models).

export type ChangeType = "BREAKING" | "DEPRECATION" | "NEW_FEATURE";

export type MigrationOperation =
  | "PARAM_RENAME"
  | "PARAM_REMOVED"
  | "PARAM_REQUIRED"
  | "SYMBOL_RENAME"
  | "METHOD_MOVED";

export interface MigrationHint {
  operation: MigrationOperation;
  from: string;
  to?: string;
}

export interface ChangeRecord {
  changeRecordId: string;
  providerId: string;
  symbol: string; // e.g. "charges.create"
  changeType: ChangeType;
  sourceVersion: string;
  detectedAt: string; // ISO-8601
  sourceKind: "OPENAPI" | "SDK_RELEASE";
  migration?: MigrationHint;
  summary: string;
}

// ---- OpenAPI-ish normalized spec used for diffing ----

export interface ApiSymbol {
  name: string; // e.g. "charges.create"
  requiredParams: string[];
  optionalParams: string[];
  deprecated: boolean;
}

export interface OpenAPISpec {
  providerId: string;
  version: string;
  symbols: ApiSymbol[];
}

export type SymbolDiffKind =
  | "SYMBOL_REMOVED"
  | "SYMBOL_ADDED"
  | "SYMBOL_DEPRECATED"
  | "REQUIRED_PARAM_REMOVED"
  | "REQUIRED_PARAM_ADDED"
  | "PARAM_RENAMED";

export interface SymbolDiff {
  symbol: string;
  kind: SymbolDiffKind;
  // migration-relevant metadata
  paramFrom?: string;
  paramTo?: string;
}

// ---- Scanning / fixing ----

export type SourceLanguage = "TYPESCRIPT" | "JAVASCRIPT" | "PYTHON" | "OTHER";

export interface UsageLocation {
  filePath: string;
  line: number;
  column: number;
}

export interface AffectedUsage {
  usageId: string;
  changeRecordId: string;
  repositoryId: string;
  location: UsageLocation;
  symbol: string;
  resolved: boolean;
  // raw matched text (for fix generation / display)
  snippet?: string;
}

export interface ProposedEdit {
  filePath: string;
  // 1-based line, 0-based column, matching Babel loc
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  replacement: string;
  usageId: string;
}

export interface FixResult {
  edits: ProposedEdit[];
  unresolved: AffectedUsage[];
}

export interface DeserializationError {
  ok: false;
  error: string;
  raw: string;
}

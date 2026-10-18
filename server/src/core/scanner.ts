import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import * as t from "@babel/types";
import type { AffectedUsage, ChangeRecord, SourceLanguage } from "./types.js";

// @babel/traverse ships as CJS; normalize the default export for ESM.
const traverse = (_traverse as unknown as { default: typeof _traverse }).default ?? _traverse;

let usageCounter = 0;
function nextUsageId(): string {
  return `u_${Date.now().toString(36)}_${(usageCounter++).toString(36)}`;
}

export function languageOf(filePath: string): SourceLanguage {
  if (/\.tsx?$/.test(filePath)) return "TYPESCRIPT";
  if (/\.jsx?$/.test(filePath)) return "JAVASCRIPT";
  if (/\.py$/.test(filePath)) return "PYTHON";
  return "OTHER";
}

export function isSupported(lang: SourceLanguage): boolean {
  return lang === "TYPESCRIPT" || lang === "JAVASCRIPT" || lang === "PYTHON";
}

/**
 * Build the member-access chain for a callee, e.g. `stripe.charges.create`
 * -> ["stripe","charges","create"]. Returns [] if not a plain member/identifier chain.
 */
function calleeChain(node: t.Node): string[] {
  if (t.isIdentifier(node)) return [node.name];
  if (t.isMemberExpression(node) && !node.computed && t.isIdentifier(node.property)) {
    const objChain = calleeChain(node.object);
    if (objChain.length === 0) return [];
    return [...objChain, node.property.name];
  }
  return [];
}

/**
 * Does the callee chain end with the change record's symbol?
 * symbol "charges.create" matches chain [...,"charges","create"].
 */
function chainMatchesSymbol(chain: string[], symbol: string): boolean {
  const parts = symbol.split(".");
  if (parts.length > chain.length) return false;
  const tail = chain.slice(chain.length - parts.length);
  return parts.every((p, i) => p === tail[i]);
}

export interface FileToScan {
  filePath: string;
  content: string;
}

/**
 * Collect local binding names that originate from the provider SDK package.
 * Handles: `import demo from "pkg"`, `import { demo } from "pkg"`,
 * `import * as demo from "pkg"`, and `const demo = require("pkg")`.
 * Returns the set of root identifiers that refer to the SDK. If null is
 * returned, no SDK import was found in the file.
 */
function sdkBindings(ast: t.File, sdkPackage: string): Set<string> {
  const bindings = new Set<string>();
  traverse(ast, {
    ImportDeclaration(path) {
      if (path.node.source.value !== sdkPackage) return;
      for (const spec of path.node.specifiers) {
        bindings.add(spec.local.name);
      }
    },
    VariableDeclarator(path) {
      const init = path.node.init;
      if (
        init &&
        t.isCallExpression(init) &&
        t.isIdentifier(init.callee) &&
        init.callee.name === "require" &&
        init.arguments.length === 1 &&
        t.isStringLiteral(init.arguments[0]) &&
        init.arguments[0].value === sdkPackage &&
        t.isIdentifier(path.node.id)
      ) {
        bindings.add(path.node.id.name);
      }
    },
  });
  return bindings;
}

/**
 * Scan a set of JS/TS files for usages of the symbol named in a Change Record (R4).
 * Uses real AST parsing and resolves import bindings to the provider SDK, so a
 * local object that merely shares the symbol's shape is NOT a false positive.
 *
 * @param sdkPackage the provider's SDK package (e.g. "demo-pay"). When provided,
 *   only calls rooted at an identifier imported from that package are matched.
 */
export function scanJsTs(
  files: FileToScan[],
  changeRecord: ChangeRecord,
  repositoryId: string,
  sdkPackage?: string
): AffectedUsage[] {
  const usages: AffectedUsage[] = [];
  const targetParam = changeRecord.migration?.from;
  const isParamChange =
    changeRecord.migration?.operation === "PARAM_RENAME" ||
    changeRecord.migration?.operation === "PARAM_REMOVED";

  for (const file of files) {
    const lang = languageOf(file.filePath);
    if (lang !== "TYPESCRIPT" && lang !== "JAVASCRIPT") continue;

    let ast;
    try {
      ast = parse(file.content, {
        sourceType: "module",
        plugins: ["typescript", "jsx"],
        errorRecovery: true,
      });
    } catch {
      continue; // unparseable file: skip, don't crash the scan
    }

    // Resolve which local identifiers actually refer to the SDK.
    const bindings = sdkPackage ? sdkBindings(ast, sdkPackage) : null;
    if (bindings && bindings.size === 0) continue; // file doesn't import the SDK

    traverse(ast, {
      CallExpression(path) {
        const chain = calleeChain(path.node.callee);
        if (!chainMatchesSymbol(chain, changeRecord.symbol)) return;
        // Binding resolution: the root of the chain must be an SDK binding.
        if (bindings && (chain.length === 0 || !bindings.has(chain[0]))) return;

        // Default: the call site itself is the usage location.
        let loc = path.node.callee.loc?.end ?? path.node.loc?.start;

        // For param-level changes, try to pinpoint the object property.
        let snippet: string | undefined;
        if (isParamChange && targetParam) {
          const objArg = path.node.arguments.find((a) => t.isObjectExpression(a)) as
            | t.ObjectExpression
            | undefined;
          const prop = objArg?.properties.find(
            (p): p is t.ObjectProperty =>
              t.isObjectProperty(p) &&
              !p.computed &&
              ((t.isIdentifier(p.key) && p.key.name === targetParam) ||
                (t.isStringLiteral(p.key) && p.key.value === targetParam))
          );
          if (!prop) return; // symbol used, but not the affected param -> not affected
          loc = prop.key.loc?.start ?? loc;
          snippet = targetParam;
        }

        if (!loc) return;
        usages.push({
          usageId: nextUsageId(),
          changeRecordId: changeRecord.changeRecordId,
          repositoryId,
          symbol: changeRecord.symbol,
          location: { filePath: file.filePath, line: loc.line, column: loc.column },
          resolved: false,
          snippet,
        });
      },
    });
  }

  return usages;
}

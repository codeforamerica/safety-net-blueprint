import { parse } from '../formula-parser.js';

/**
 * Recursively visits every node in a formula AST, calling visitor(node) for each.
 * Skips non-object/null nodes and avoids cycles by only visiting own values.
 */
export function walkAst(node, visitor) {
  if (!node || typeof node !== 'object') return;
  visitor(node);
  for (const val of Object.values(node)) {
    if (Array.isArray(val)) val.forEach(v => walkAst(v, visitor));
    else if (val && typeof val === 'object') walkAst(val, visitor);
  }
}

/**
 * Parse a formula string into an AST. Returns null if parsing fails.
 */
export function parseFormula(formulaStr) {
  try {
    return parse(String(formulaStr));
  } catch {
    return null;
  }
}

/**
 * Returns the latest version's formula string for a rule, or null if absent.
 */
export function latestFormula(rule) {
  const versions = rule.versions ?? [];
  if (versions.length === 0) return null;
  const formula = versions[versions.length - 1].formula;
  return formula != null ? String(formula) : null;
}

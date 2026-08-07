#!/usr/bin/env node
/**
 * Rulespec → blueprint-dsl fact translator.
 *
 * Usage (CLI):
 *   node src/sources/rulespec/translate-rulespec.js <rulespec.yaml> [--out <file.json>]
 *
 * Programmatic:
 *   import { buildRulespecFacts } from './translate-rulespec.js';
 *   const { facts, translationLog } = buildRulespecFacts(rulespec);
 *
 * Output format matches the blueprint-dsl translator pipeline output:
 *   { facts: Array<Fact>, translationLog: string[] }
 *
 * Each Fact is one of:
 *   { path: string, placeholder: string, writable: true }   — parameter
 *   { path: string, writable: true }                        — data relation
 *   { path: string, derived: string }                       — derived rule (CEL)
 *
 * Translation rules:
 *   kind: parameter     → /parameter/<name>, writable, placeholder = latest formula
 *   kind: data_relation → /<entity>/<name>[_<discVal>]*, writable
 *                         Expanded once per enum value for each discriminator
 *                         (non-last, non-primitive enum sig element).
 *   kind: derived       → /<entity>/<name>, derived = CEL translation of latest formula
 *   other kinds         → skipped (definition, notice, procedure are not translatable)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadRulespec } from './load-rulespec.js';
import { translateFormula } from './formula-to-cel.js';
import { parseCliArgs } from '../../cli-utils.js';

/** Sig types that indicate the first element is an "entity" position. */
const ENTITY_SIG_TYPES = new Set(['Person', 'Case', 'Month', 'Day']);

/** Period types that appear as temporal position markers in signatures. */
const PERIOD_SIG_TYPES = new Set(['Month', 'Day', 'Eternity']);

/** Primitive return types: when the last sig element is one of these, it is
 *  the return type and is not a discriminator even if it were an enum name. */
const PRIMITIVE_SIG_TYPES = new Set(['Integer', 'Money', 'Rate', 'Date', 'Boolean', 'String']);

/**
 * Translates a loaded rulespec model into blueprint-dsl facts.
 *
 * @param {{
 *   types: Map<string, {kind: string, values?: (string|object)[]}>
 *   parameters: object[]
 *   dataRelations: object[]
 *   derivedRules: object[]
 * }} rulespec - Output of loadRulespec()
 * @returns {{ facts: object[], translationLog: string[] }}
 */
export function buildRulespecFacts(rulespec) {
  const { types, parameters, dataRelations, derivedRules } = rulespec;

  // ── Build translation context ────────────────────────────────────────────

  // All enum values across all enum types, for identifier recognition.
  const enumValues = new Set();
  const enumTypes = new Set(); // names of types whose kind is 'enum'
  for (const [typeName, typeDef] of types) {
    if (typeDef.kind === 'enum') {
      enumTypes.add(typeName);
      for (const v of typeDef.values ?? []) {
        enumValues.add(typeof v === 'string' ? v : String(v));
      }
    }
  }

  const parameterNames = new Set(parameters.map(p => p.name));

  // Build callables map: name → { sigTypes } for formula-to-cel call resolution.
  // Both data_relations and derived rules are callable from formula text.
  const callables = new Map();

  for (const dr of dataRelations) {
    callables.set(dr.name, { sigTypes: dr.signature ?? [] });
  }
  for (const dr of derivedRules) {
    // Derived rules don't have a YAML `signature` field; reconstruct it from
    // `entity` and `period` so call-arg alignment works the same way.
    const sigTypes = [];
    if (dr.entity) sigTypes.push(dr.entity);
    if (dr.period) sigTypes.push(dr.period);
    callables.set(dr.name, { sigTypes });
  }

  const ctx = { parameterNames, enumValues, callables };

  // ── Translate ────────────────────────────────────────────────────────────

  const facts = [];
  const translationLog = [];

  // 1. Parameters → writable facts with placeholder
  for (const param of parameters) {
    const versions = param.versions ?? [];
    const latestFormula = versions.length > 0 ? versions[versions.length - 1].formula : undefined;
    const placeholder = latestFormula !== undefined ? String(latestFormula) : undefined;

    const fact = { path: `/parameter/${param.name}`, writable: true };
    if (placeholder !== undefined) fact.placeholder = placeholder;
    facts.push(fact);
  }

  // 2. Data relations → writable facts (expand discriminator enum positions)
  for (const dr of dataRelations) {
    const sig = dr.signature ?? [];
    const entityFact = entityPrefixFromSig(sig);

    // Find discriminator positions: non-last elements that are enum types
    // (not entity types, not period types, not primitives).
    const discPositions = [];
    for (let i = 1; i < sig.length - 1; i++) {
      const t = sig[i];
      if (enumTypes.has(t) && !ENTITY_SIG_TYPES.has(t) && !PERIOD_SIG_TYPES.has(t)) {
        discPositions.push(i);
      }
    }

    if (discPositions.length === 0) {
      facts.push({ path: `/${entityFact}/${dr.name}`, writable: true });
    } else {
      // Single discriminator (multiple discriminators not observed in the real rulespec).
      // For a multi-discriminator relation, this would need a cartesian product — skip
      // that until a real example exists.
      const discPos = discPositions[0];
      const discTypeName = sig[discPos];
      const discTypeDef = types.get(discTypeName);
      const discValues = discTypeDef?.values ?? [];
      for (const val of discValues) {
        const valStr = typeof val === 'string' ? val : String(val);
        facts.push({ path: `/${entityFact}/${dr.name}_${valStr}`, writable: true });
      }
      if (discValues.length === 0) {
        // Unknown enum type — fall back to a single fact without suffix
        translationLog.push(`WARNING: data_relation '${dr.name}' has discriminator type '${discTypeName}' with no known values; emitting a single fact`);
        facts.push({ path: `/${entityFact}/${dr.name}`, writable: true });
      }
    }
  }

  // 3. Derived rules → derived facts with CEL formula
  for (const dr of derivedRules) {
    const versions = dr.versions ?? [];
    if (versions.length === 0) {
      translationLog.push(`SKIP: derived rule '${dr.name}' has no versions`);
      continue;
    }
    const latestVersion = versions[versions.length - 1];
    const formulaStr = latestVersion.formula;
    if (formulaStr === undefined || formulaStr === null) {
      translationLog.push(`SKIP: derived rule '${dr.name}' latest version has no formula`);
      continue;
    }

    const entityPrefix = (dr.entity ?? 'context').toLowerCase();
    const path = `/${entityPrefix}/${dr.name}`;

    let cel;
    try {
      cel = translateFormula(String(formulaStr), ctx);
    } catch (err) {
      translationLog.push(`ERROR: could not translate formula for '${dr.name}': ${err.message}`);
      continue;
    }

    facts.push({ path, derived: cel });
  }

  return { facts, translationLog };
}

/** Returns the entity path segment from a signature array.
 *  Uses the first element if it is an entity/period type, else 'context'. */
function entityPrefixFromSig(sig) {
  if (sig.length > 0 && (ENTITY_SIG_TYPES.has(sig[0]) || PERIOD_SIG_TYPES.has(sig[0]))) {
    return sig[0].toLowerCase();
  }
  return 'context';
}

// ── CLI entry point ──────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseCliArgs(process.argv);
  if (!args) {
    console.error('Usage: node src/sources/rulespec/translate-rulespec.js <rulespec.yaml> [--out <file.json>]');
    process.exit(0);
  }

  const rulespec = loadRulespec(args.positional);
  const result = buildRulespecFacts(rulespec);

  if (result.translationLog.length) {
    for (const msg of result.translationLog) console.error(msg);
  }

  if (args.outFile) {
    writeFileSync(args.outFile, JSON.stringify(result, null, 2));
    console.log(`Wrote ${result.facts.length} facts to ${args.outFile}`);
  } else {
    console.log(`Translated ${result.facts.length} facts`);
    console.log(`  ${result.facts.filter(f => f.placeholder !== undefined).length} parameters`);
    console.log(`  ${result.facts.filter(f => f.writable && f.placeholder === undefined).length} data relations`);
    console.log(`  ${result.facts.filter(f => f.derived !== undefined).length} derived rules`);
    if (result.translationLog.length) {
      console.log(`  ${result.translationLog.length} translation log entries (see stderr)`);
    }
  }
}

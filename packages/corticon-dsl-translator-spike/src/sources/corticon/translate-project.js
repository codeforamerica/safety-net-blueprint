#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { buildFacts } from './translate/build-facts.js';
import { classifyProject } from './classify/classify-all.js';
import { ENGINES, DEFAULT_ENGINE, resolveEngine } from '../../engines.js';
import { toJson, parseCliArgs } from '../../cli-utils.js';
import { validateSchema } from '../../validate-schema.js';
import { entriesOf } from '../../map-utils.js';
import { canonicalAttributePath } from '../../graph/attribute-path.js';

function printUsage() {
  console.error('Usage: node src/translate-project.js <project.json> [--engine <name>] [--out <graph.json>] [--translation-log <file.json>]');
  console.error('  <project.json> is the output of: node src/ingest-project.js <dir> --out <project.json>');
  console.error(`  --engine defaults to "${DEFAULT_ENGINE}". Known engines: ${Object.keys(ENGINES).join(', ')}`);
  console.error('  --out writes the enriched universal rule graph (nodes, edges, functions)');
  console.error('  --translation-log writes per-pattern translation findings');
  console.error('Example: node src/translate-project.js generated/dc-medicaid-chip.json --out generated/dc-medicaid-chip.graph.json --translation-log generated/dc-medicaid-chip.translation-log.json');
}


// Corticon vocabulary type name → JSON Schema primitive type string.
const PRIMITIVE_TYPE_MAP = {
  Integer: 'integer',
  Decimal: 'number', Float: 'number', Real: 'number', Double: 'number',
  String: 'string', Text: 'string',
  Boolean: 'boolean', boolean: 'boolean',
};

// Returns a JSON Schema fragment (object) for a Corticon type, or null if unmappable.
function corticonTypeToJsonSchema(cortType, customTypes) {
  if (!cortType) return null;
  if (PRIMITIVE_TYPE_MAP[cortType]) return { type: PRIMITIVE_TYPE_MAP[cortType] };
  if (cortType === 'Date') return { type: 'string', format: 'date' };
  if (cortType === 'DateTime') return { type: 'string', format: 'date-time' };
  if (cortType === 'Time') return { type: 'string', format: 'time' };
  const ct = customTypes?.get(cortType);
  if (ct?.isEnum) {
    const result = { type: 'string', enum: ct.values };
    if (ct.entries?.some((e) => e.label)) result.enumDescriptions = ct.entries.map((e) => e.label ?? '');
    return result;
  }
  return null;
}

// Expression-level patterns → non-baseline CEL functions they require
const PATTERN_FUNCTIONS = {
  'date-arithmetic':    ['yearsBetween'],
  'rounding':           ['round'],
  'scalar-accumulator': ['sum'],
};

function summarize({ translationLog }) {
  const byStatus = {};
  for (const entry of translationLog) {
    byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1;
  }
  return { translationLogCount: translationLog.length, byStatus };
}

const args = parseCliArgs(process.argv);
if (!args) {
  printUsage();
  process.exit(0);
}

let parseExpression;
try {
  ({ parseExpression } = await resolveEngine(args.engine ?? DEFAULT_ENGINE));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const project = JSON.parse(readFileSync(args.positional, 'utf-8'));

// Classification (was a separate pipeline step; now internal to translate)
const classificationResult = classifyProject(project);
const { patterns, ruleflowContext, sinkCandidates: classifiedCandidates } = classificationResult;

const { buildDependencyGraph, buildCandidateSubgraph } = await import('../../graph/build-graph.js');

// Exclude unreachable (dead) rulesheets from the dependency graph — they are not
// invoked by any ruleflow node and should not contribute edges or nodes.
const unreachableBasenames = new Set(ruleflowContext.unreachableRulesheets);
const reachableProject = unreachableBasenames.size === 0 ? project : {
  ...project,
  rulesheets: Object.fromEntries(
    Object.entries(project.rulesheets).filter(([path]) => !unreachableBasenames.has(basename(path)))
  ),
};
const rawGraph = buildDependencyGraph(reachableProject);

// Compile facts + translation log (domain/graphName omitted — graph uses canonical paths)
const translation = buildFacts(project, rawGraph, patterns, { parseExpression, ruleflowContext });

// ── Build vocabulary type map ─────────────────────────────────────────────────
const vocabDatatypeByPath = new Map();
const vocabCustomTypes = new Map();
for (const [, vocab] of entriesOf(project.vocabularies)) {
  for (const [entityName, entity] of entriesOf(vocab.entities)) {
    for (const [attrName, attr] of entriesOf(entity.attributes)) {
      if (attr.dataType) vocabDatatypeByPath.set(`${entityName}.${attrName}`, attr.dataType);
    }
  }
  for (const [typeName, typeInfo] of entriesOf(vocab.customTypes ?? {})) {
    vocabCustomTypes.set(typeName, typeInfo);
  }
}

// ── Infer enum types from rule expressions (EnumType#Literal syntax) ──────────
// Corticon stores enum values as EnumTypeName#LiteralCode_HumanLabel in the
// opaqueExpression, but resolves them to plain strings in parserOutput — so
// term.datatype is just 'String', not the specific enum type. Scan each cell's
// raw expression for the Type#Literal pattern and pair with the ATTRIBUTE terms
// in that cell to infer which attribute uses which enum type.
// Only overrides paths currently typed as a generic string primitive (String/Text)
// so explicit eType-based enum bindings (dc-medicaid-chip style) are never clobbered.
const ENUM_LIT_RE = /\b([A-Za-z_]\w*)#[A-Za-z_]\w*/g;
for (const [, rulesheet] of entriesOf(project.rulesheets)) {
  for (const rule of rulesheet.rules ?? []) {
    for (const cell of [...(rule.conditions ?? []), ...(rule.actions ?? [])].filter(Boolean)) {
      if (!cell.expression) continue;
      const enumTypeNames = new Set();
      for (const m of cell.expression.matchAll(ENUM_LIT_RE)) {
        if (vocabCustomTypes.has(m[1])) enumTypeNames.add(m[1]);
      }
      if (!enumTypeNames.size) continue;
      const [enumTypeName] = enumTypeNames;
      for (const term of [...(cell.modifiedTerms ?? []), ...(cell.referencedTerms ?? [])]) {
        if (term.termtype !== 'ATTRIBUTE') continue;
        const path = canonicalAttributePath(term);
        if (!path) continue;
        const existing = vocabDatatypeByPath.get(path);
        if (!existing || existing === 'String' || existing === 'Text') {
          vocabDatatypeByPath.set(path, enumTypeName);
        }
      }
    }
  }
}

// ── Build enriched graph ──────────────────────────────────────────────────────
// Lowercase-to-canonical mapping: factPathFromCanonicalPath without domain/graphName
// lowercases the entity name (e.g. Person.age → person.age). Reverse-map via the
// raw graph's canonical node paths so we can match fact paths back to canonical.
const canonicalByLower = new Map();
for (const node of rawGraph.nodes) {
  canonicalByLower.set(node.toLowerCase(), node);
}
// Also cover vocabulary paths not in rawGraph.nodes (needed for derived-node type lookup)
for (const path of vocabDatatypeByPath.keys()) {
  if (!canonicalByLower.has(path.toLowerCase())) canonicalByLower.set(path.toLowerCase(), path);
}

const writtenPaths = new Set([...rawGraph.writes.keys()]);
// Set of paths actually referenced in at least one rule edge (read or written)
const rawGraphNodeLower = new Set([...rawGraph.nodes].map(n => n.toLowerCase()));

const graphNodes = {};

// Input nodes: vocabulary attributes that are actually used in rules (appear in rawGraph.nodes)
// and not written by any rule → $.CanonicalPath.
// Vocabulary attributes declared but never referenced in any rule are excluded from the graph.
for (const [canonicalPath, cortType] of vocabDatatypeByPath) {
  if (!writtenPaths.has(canonicalPath) && rawGraphNodeLower.has(canonicalPath.toLowerCase())) {
    const schema = corticonTypeToJsonSchema(cortType, vocabCustomTypes);
    graphNodes[`$.${canonicalPath}`] = schema ?? {};
  }
}

// Derived nodes: facts with compiled CEL expressions → CanonicalPath
// Spread JSON Schema fragment directly onto the node.
for (const fact of translation.facts) {
  if (fact.expression) {
    // fact.path is lowercased canonical (e.g. "person.age"); map back to "Person.age"
    const canonical = canonicalByLower.get(fact.path.toLowerCase()) ?? fact.path;
    const cortType = vocabDatatypeByPath.get(canonical);
    const schema = cortType ? corticonTypeToJsonSchema(cortType, vocabCustomTypes) : null;
    graphNodes[canonical] = { expression: fact.expression, ...(schema ?? {}) };
  }
}

// Edges: raw graph edges → enriched with edgeId, $.prefix for input from-nodes
// Format: { edgeId: [{from, to}, ...] }
const seenEdgeKeys = new Set();
const graphEdges = {};
for (const { from, to, rulesheet, ruleIndex } of rawGraph.edges) {
  const fromPath = writtenPaths.has(from) ? from : `$.${from}`;
  const edgeId = `${basename(rulesheet)}:${ruleIndex}`;
  const k = `${fromPath}\u2192${to}\u2192${edgeId}`;
  if (!seenEdgeKeys.has(k)) {
    seenEdgeKeys.add(k);
    if (!graphEdges[edgeId]) graphEdges[edgeId] = [];
    graphEdges[edgeId].push({ from: fromPath, to });
  }
}

// Functions: collect non-baseline CEL functions from expression-level patterns
// Note: must use Object.hasOwn, not just PATTERN_FUNCTIONS[p.pattern] -- 'constructor'
// is a built-in property on all plain objects and would pass a truthy check.
const functions = [...new Set(
  patterns
    .filter(p => Object.hasOwn(PATTERN_FUNCTIONS, p.pattern))
    .flatMap(p => PATTERN_FUNCTIONS[p.pattern]),
)];

const enrichedGraph = {
  ...(functions.length ? { functions } : {}),
  nodes: graphNodes,
  edges: graphEdges,
};

const summary = summarize(translation);

if (args.outFile) {
  validateSchema('graph', enrichedGraph, args.outFile);
  writeFileSync(args.outFile, JSON.stringify(enrichedGraph, null, 2));
  console.log(`Wrote graph to ${args.outFile}`);
}
if (args.translationLogFile) {
  // Compute subgraph nodeCount + depth for each sink candidate so the visualizer is dumb
  const subgraphMeta = {};
  const allPairs = Object.values(enrichedGraph.edges).flat();
  const nonSelfPairs = allPairs.filter(e => e.from !== e.to);
  const fromSet = new Set(nonSelfPairs.map(e => e.from));
  const toSet   = new Set(allPairs.map(e => e.to));
  const sinkKeys = new Set([
    ...Object.keys(classifiedCandidates ?? {}),
    ...[...toSet].filter(p => !fromSet.has(p)),
  ]);
  const enrichedGraphNorm = { ...enrichedGraph, edges: allPairs };
  for (const key of sinkKeys) {
    try {
      const sub = buildCandidateSubgraph(key, enrichedGraphNorm);
      subgraphMeta[key] = {
        nodeCount:     sub.nodeCount,
        depth:         sub.depth,
        nodes:         sub.nodes,
        orderedLayers: sub.orderedLayers,
        edges:         sub.edges.map(e => ({ from: e.from, to: e.to })),
      };
    } catch { /* skip */ }
  }

  const entriesByPattern = {};
  for (const entry of toJson(translation.translationLog)) {
    const p = entry.pattern ?? 'unknown';
    if (!entriesByPattern[p]) entriesByPattern[p] = [];
    entriesByPattern[p].push(entry);
  }

  const logOutput = {
    entries: entriesByPattern,
    sinkCandidates: Object.fromEntries(
      [...sinkKeys].map(k => {
        const v = classifiedCandidates?.[k] ?? {};
        const m = subgraphMeta[k] ?? {};
        return [k, {
          nodeCount:        m.nodeCount,
          depth:            m.depth,
          nodes:            m.nodes,
          orderedLayers:    m.orderedLayers,
          edges:            m.edges,
          definitionCount:  v.definitionCount,
          totalDefinitions: v.totalDefinitions,
          latestPosition:   v.latestPosition,
          totalPositions:   v.totalPositions,
        }];
      })
    ),
  };
  writeFileSync(args.translationLogFile, JSON.stringify(logOutput, null, 2));
  console.log(`Wrote translation log to ${args.translationLogFile}`);
}
console.log(JSON.stringify(summary, null, 2));

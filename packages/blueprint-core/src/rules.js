/**
 * Rules compiler.
 *
 * Compiles *-rules.yaml source files into *-graph.yaml compiled graphs and
 * generates OpenAPI overlay documents for rulesets that declare standalone
 * endpoints. The graph format is the universal intermediate representation
 * consumed by the evaluator, mock server, explorer, and translators.
 *
 * Compilation steps for each ruleset:
 *   1. expandInputs — walk the input schema recursively, emitting one graph
 *      input node per field ($.namespace.field, $.namespace.array[], etc.)
 *   2. extractDeps — scan each fact's CEL expression for references to input
 *      paths and other facts; build the dependencies map
 *   3. Assemble the graph document (schema, format version, domain, ruleset,
 *      outputs, inputs, facts, dependencies)
 *
 * Endpoint overlay generation follows the same pattern as compositions:
 * returns an OpenAPI Overlay 1.0.0 document that adds the POST endpoint and
 * a stub request/response schema to the domain's OpenAPI spec.
 */

import { buildParameterIndex, buildPathEntry, toPascalCase } from './openapi/utils.js';

// ── Input expansion ──────────────────────────────────────────────────────────

/**
 * Expand a ruleset's inputs map into JSONPath field-level graph input nodes.
 *
 * Each named input in the rules schema (e.g. household, policy) is an object
 * schema or $ref. The compiler walks each schema recursively and emits one
 * graph input node per reachable field, keyed by its JSONPath:
 *
 *   household.monthlyIncome (number)  →  $.household.monthlyIncome: { type: number }
 *   household.members (array)         →  $.household.members[]: { type: array }
 *   household.members[].age (integer) →  $.household.members[].age: { type: integer }
 *
 * Object containers (e.g. household itself) are not emitted — only their
 * leaf fields appear in the graph inputs map.
 *
 * @param {Object} inputsMap - { inputName: schemaOrRef, ... }
 * @returns {Object} { [jsonPath]: nodeSpec }
 */
export function expandInputs(inputsMap, resolve = () => null) {
  const result = {};
  for (const [inputName, schema] of Object.entries(inputsMap || {})) {
    expandSchema(`$.${inputName}`, schema, result, resolve);
  }
  return result;
}

/**
 * Walk a declared input schema into the flat field paths a graph carries.
 *
 * A `$ref` is followed. It used to emit a single opaque `{type:'object'}`
 * node instead, which collapsed every leaf beneath it: a fact reading
 * `members[].isDisabled` recorded a dependency on `$.members` and nothing
 * finer, so one absent field reported the whole object as missing. Partial
 * evaluation is the reason this contract type exists, and that defeated it —
 * which is why no ruleset used `$ref`, despite the schema's own example
 * showing one.
 *
 * `seen` guards a schema that refers to itself. A self-referential type is
 * legitimate — a household member with dependents, say — but it has no finite
 * set of leaf paths, so expansion stops and the node stays opaque.
 */
function expandSchema(prefix, schema, result, resolve = () => null, seen = new Set()) {
  if (!schema) return;

  if (schema.$ref) {
    if (seen.has(schema.$ref)) {
      result[prefix] = { type: 'object', description: `Recursive reference to ${schema.$ref}` };
      return;
    }

    const target = resolve(schema.$ref);
    if (!target || typeof target !== 'object' || Object.keys(target).length === 0) {
      // Unresolvable. Opaque is the honest result — better than inventing
      // leaf paths — and the validator reports the unresolved ref separately.
      result[prefix] = { type: 'object' };
      return;
    }

    // 2020-12 allows keywords alongside $ref, and treats them as applying in
    // addition to it. A description written at the referring site is the more
    // specific one — it says what this input is, where the target says what
    // the shared type is — so it wins.
    const { $ref: _ref, ...siblings } = schema;
    const merged = { ...target, ...siblings };
    expandSchema(prefix, merged, result, resolve, new Set([...seen, schema.$ref]));
    return;
  }

  if (schema.type === 'object') {
    if (schema.properties) {
      // Expand properties recursively — do not emit the object container itself
      for (const [field, fieldSchema] of Object.entries(schema.properties)) {
        expandSchema(`${prefix}.${field}`, fieldSchema, result, resolve, seen);
      }
    } else {
      // Opaque object with no declared properties
      const node = { type: 'object' };
      if (schema.description) node.description = schema.description;
      result[prefix] = node;
    }
    return;
  }

  if (schema.type === 'array') {
    // Array node: type is 'array', not the item type
    const arrayPath = `${prefix}[]`;
    const node = { type: 'array' };
    if (schema.description) node.description = schema.description;
    result[arrayPath] = node;

    // Expand item properties as sub-fields of the array path. `items` may be
    // a $ref — a collection of a shared type is the common shape — so follow
    // it before looking for properties.
    const items = schema.items?.$ref && !seen.has(schema.items.$ref)
      ? resolve(schema.items.$ref) ?? schema.items
      : schema.items;
    const itemSeen = schema.items?.$ref ? new Set([...seen, schema.items.$ref]) : seen;

    if (items?.properties) {
      for (const [field, fieldSchema] of Object.entries(items.properties)) {
        expandSchema(`${arrayPath}.${field}`, fieldSchema, result, resolve, itemSeen);
      }
    }
    return;
  }

  // Scalar leaf node
  const node = {};
  if (schema.type) node.type = schema.type;
  if (schema.description) node.description = schema.description;
  if (schema.default !== undefined) node.default = schema.default;
  if (schema.enum) node.enum = schema.enum;
  if (schema.format) node.format = schema.format;
  result[prefix] = node;
}

// ── Dependency extraction ────────────────────────────────────────────────────

/**
 * Extract dependencies for a fact from its CEL expression.
 *
 * Scans the expression for references to input paths and other fact names.
 * Array sub-field paths ($.x.y[].field) are skipped — the parent array path
 * ($.x.y[]) is the dependency that drives missing-input tracking. Sub-fields
 * exist in the inputs map for type info and FactGraph translation only.
 *
 * @param {string}   expression   - CEL expression string
 * @param {string[]} inputPaths   - all expanded input paths from expandInputs()
 * @param {string[]} factPaths    - camelCase fact path names declared before this fact
 * @returns {string[]} dependency paths in order of first appearance
 */
export function extractDeps(expression, inputPaths, factPaths) {
  const deps = [];
  const seen = new Set();

  function add(dep) {
    if (!seen.has(dep)) { seen.add(dep); deps.push(dep); }
  }

  for (const inputPath of inputPaths) {
    const withoutDollar = inputPath.slice(2); // $.x.y → x.y

    // Skip array sub-fields ($.household.members[].age) —
    // the parent array path ($.household.members[]) is the dependency.
    if (/\[\]\.[a-zA-Z]/.test(withoutDollar)) continue;

    // Convert to CEL reference form:
    //   $.household.monthlyIncome → household.monthlyIncome
    //   $.household.members[]    → household.members
    const celRef = withoutDollar.replace(/\[\]$/, '');

    if (containsPathRef(expression, celRef)) {
      add(inputPath);
    }
  }

  for (const factPath of factPaths) {
    // A grouped fact's path has dots, which match literally — `risks.cashIncome`,
    // not `risksXcashIncome` — and a reference to it is the whole path.
    if (containsPathRef(expression, factPath)) {
      add(factPath);
    }
  }

  return deps;
}

/**
 * Test whether a dotted CEL path appears in an expression at a reference site.
 * Requires a non-identifier character (or string start) before the path.
 * Allows any non-identifier character after — including '.' so that array
 * refs like "household.members" match before ".filter(...)".
 */
function containsPathRef(expression, celRef) {
  const escaped = celRef.replace(/\./g, '\\.').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
  return new RegExp(`(?<![a-zA-Z0-9$_.])${escaped}(?![a-zA-Z0-9_])`, 'u').test(expression);
}

// ── Per-item facts ───────────────────────────────────────────────────────────

/**
 * The list fact a per-item fact is on: `reviewMonths[].reviewWeeks[].worked`
 * is on `reviewMonths[].reviewWeeks`. Null for a fact on no list.
 *
 * @param {string} factPath
 * @returns {string|null}
 */
export function listFactOf(factPath) {
  const at = factPath.lastIndexOf('[].');
  return at < 0 ? null : factPath.slice(0, at);
}

/**
 * What a fact depends on through per-item facts, beyond what extractDeps
 * finds in its expression.
 *
 * A per-item fact depends on its list and on every list enclosing it, since
 * it is computed once for each of their items. It reads an enclosing item's
 * facts by that list's `as` name — `month.meetsHours` is
 * `reviewMonths[].meetsHours` — and those are dependencies too.
 *
 * Reading a list reads its items, and they carry their facts, so a fact that
 * reads a list depends on every per-item fact on it, at every depth. That
 * over-counts — `size(reviewMonths)` needs none of them — but an edge too many
 * only orders evaluation; one too few computes a fact before what it reads.
 *
 * @param {string} factPath
 * @param {string} expression
 * @param {string[]} direct - What extractDeps found
 * @param {Object<string, {as?: string}>} decls - Every fact's declaration, by path
 * @returns {string[]}
 */
function perItemDeps(factPath, expression, direct, decls) {
  const deps = [];
  const onItems = (list) => Object.keys(decls).filter((p) => p.startsWith(`${list}[].`));
  const readsList = (list) => { deps.push(list); if (decls[list]?.as) deps.push(...onItems(list)); };

  for (const dep of direct) if (decls[dep]?.as) deps.push(...onItems(dep));

  for (let list = listFactOf(factPath); list; list = listFactOf(list)) {
    deps.push(list);
    const as = decls[list]?.as;
    if (!as) continue;
    for (const itemFact of onItems(list)) {
      const name = itemFact.slice(list.length + 3);
      if (name.includes('[].') || itemFact === factPath) continue;
      if (containsPathRef(expression, `${as}.${name}`)) readsList(itemFact);
    }
  }
  return deps.filter((d) => d !== factPath);
}

// ── Ruleset compiler ─────────────────────────────────────────────────────────

/**
 * Compile a single ruleset into a graph document.
 *
 * @param {string} domain       - domain name (e.g. 'eligibility')
 * @param {string} rulesetName  - ruleset key (e.g. 'expeditedSnap')
 * @param {Object} ruleset      - ruleset object from the rules file
 * @param {(ref: string) => object|null} [resolve] - follows a $ref in an input
 *   declaration. Defaults to resolving nothing, which leaves a $ref'd input as
 *   an opaque object — the caller that has the document set supplies a real one.
 * @returns {Object} compiled graph document (ready to serialize as YAML)
 */
export function compileRuleset(domain, rulesetName, ruleset, resolve = () => null) {
  const expandedInputs = expandInputs(ruleset.inputs || {}, resolve);
  const inputPaths = Object.keys(expandedInputs);

  const facts = {};
  const dependencies = {};

  // Every fact name, before any expression is scanned. Dependencies used to be
  // extracted against only the facts declared *above* the current one, so a
  // fact referencing one declared later produced a graph with that edge simply
  // missing — which is why the validator rejected forward references outright,
  // and why the schema's promise that declaration order does not matter was
  // not true. Scanning against the complete set makes the graph correct
  // whatever order the file is written in; the evaluator already resolves
  // topologically, and cycles are detected separately.
  const factPaths = (ruleset.facts || []).map((f) => f.path);
  // A per-item fact is read through its item's name, never by its path, so
  // only facts on no list are looked for by name.
  const namedFacts = factPaths.filter((p) => !p.includes('[]'));
  const decls = Object.fromEntries((ruleset.facts || []).map((f) => [f.path, f]));

  for (const factDecl of ruleset.facts || []) {
    const { path: factPath, expression, description, type, as } = factDecl;

    // Build fact node
    const node = { expression };
    if (as) node.as = as;
    if (type) {
      // type may be a SchemaOrRef object or a plain string
      const typeStr = typeof type === 'object' ? type.type : type;
      if (typeStr) node.type = typeStr;
    }
    if (description) node.description = description;
    facts[factPath] = node;

    // A fact never depends on itself; anything else in the ruleset is fair game.
    const direct = extractDeps(expression, inputPaths, namedFacts.filter((n) => n !== factPath));
    const deps = [...new Set([...direct, ...perItemDeps(factPath, expression, direct, decls)])];
    if (deps.length > 0) {
      dependencies[factPath] = deps;
    }
  }

  // Determine outputs: prefer declared outputs keys, fall back to last fact
  const outputs = ruleset.outputs && Object.keys(ruleset.outputs).length > 0
    ? Object.keys(ruleset.outputs)
    : factPaths.slice(-1);

  // Constants are written into the graph with their values, so whatever
  // evaluates the graph has them, and where a value comes from can change
  // without any evaluator noticing.
  const constants = Object.fromEntries(Object.entries(ruleset.constants ?? {}).map(([name, p]) => [
    name,
    { value: p.value, ...(p.type ? { type: p.type } : {}), ...(p.description ? { description: p.description } : {}) },
  ]));

  // The format's edition, raised only by what the graph uses, so a graph
  // without per-item facts still runs on an engine that predates them.
  const formatVersion = factPaths.some((p) => p.includes('[]')) || (ruleset.facts || []).some((f) => f.as) ? '1.1' : '1.0';

  return {
    $schema: 'https://blueprint.codeforamerica.org/schemas/graph-schema.yaml',
    formatVersion,
    domain,
    ruleset: rulesetName,
    outputs,
    inputs: expandedInputs,
    ...(Object.keys(constants).length ? { constants } : {}),
    facts,
    dependencies,
  };
}

// ── Endpoint overlay generation ──────────────────────────────────────────────

/**
 * Where a ruleset is evaluated, relative to its domain: the `endpoint.path` it
 * declares. Every ruleset in the blueprint is reachable through its API, at a
 * path its author chose — there is no default, and no way to have none. Null
 * only for a ruleset that declares no path, which validation refuses.
 *
 * @param {string} rulesetName - e.g. "expeditedSnap"
 * @param {object} ruleset
 * @returns {string|null} e.g. "/determinations/evaluate-expedited-snap"
 */
export function rulesetEndpointPath(rulesetName, ruleset) {
  return ruleset?.endpoint?.path ?? null;
}

/**
 * The OpenAPI document a rules file's endpoints are documented in.
 *
 * A rules document stands on its own — it defines its domain, and needs no
 * OpenAPI document to exist — so its endpoints are not merged into one. They
 * get a document of their own, served under the domain's path, which Swagger,
 * the API reference and the client generators read like any other. Null when
 * every ruleset opts out.
 *
 * @param {string} domain   - domain name
 * @param {Object} rulesDoc - parsed rules YAML document
 * @param {Map} [paramIndex]
 * @returns {Object|null} An OpenAPI 3.1 document, or null
 */
export function generateRulesApi(domain, rulesDoc, paramIndex = new Map()) {
  const paths = {};
  const schemas = {};

  for (const [rulesetName, ruleset] of Object.entries(rulesDoc.rulesets || {})) {
    const endpointPath = rulesetEndpointPath(rulesetName, ruleset);
    if (!endpointPath) continue;

    const pascal = toPascalCase(rulesetName);
    const requestSchemaName = `${pascal}Request`;
    const responseSchemaName = `${pascal}Response`;
    const lastSegment = endpointPath.split('/').filter(Boolean).pop();
    const operationId = toCamelCase(lastSegment);

    // Request body: one property per named input, using the input schema
    const requestProperties = {};
    for (const [inputName, inputSchema] of Object.entries(ruleset.inputs || {})) {
      requestProperties[inputName] = inputSchema;
    }

    paths[endpointPath] = buildPathEntry(endpointPath, 'post', {
      summary: `Evaluate ${rulesetName}`,
      operationId,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: `#/components/schemas/${requestSchemaName}` },
          },
        },
      },
      responses: {
        '200': {
          description: `${rulesetName} evaluation result.`,
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${responseSchemaName}` },
            },
          },
        },
        '400': { $ref: 'https://blueprint.codeforamerica.org/base/components/responses.yaml#/BadRequest' },
        '500': { $ref: 'https://blueprint.codeforamerica.org/base/components/responses.yaml#/InternalError' },
      },
    }, paramIndex, { type: 'ruleset', domain, id: rulesetName });

    schemas[requestSchemaName] = {
      type: 'object',
      description: `Input data for ${rulesetName} evaluation. All fields are optional — partial inputs trigger partial evaluation.`,
      properties: requestProperties,
    };

    schemas[responseSchemaName] = {
      allOf: [
        { $ref: 'https://blueprint.codeforamerica.org/base/schemas/rules-evaluation.yaml#/EvaluationResult' },
      ],
      description: `Evaluation result for ${rulesetName}.`,
    };
  }

  if (Object.keys(paths).length === 0) return null;

  return {
    openapi: '3.1.0',
    info: {
      title: `${toPascalCase(domain)} rules`,
      version: String(rulesDoc.version ?? '1.0.0'),
      description: `Evaluation endpoints for the ${domain} rulesets, generated from their rules document.`,
      'x-domain': domain,
    },
    servers: [{ url: `/${domain}` }],
    paths,
    components: { schemas },
  };
}

/**
 * Compile all rules files, and generate the API document each one's endpoints are documented in.
 *
 * @param {Array<{ relativePath: string, doc: Object }>} rulesFiles
 * @returns {{ graphs: Map<string, Object>, apis: Map<string, Object> }} Each keyed by the relative path to write it at
 */
export function generateRulesResults(rulesFiles, yamlFiles = [], resolve = () => null) {
  const graphs = new Map();
  const apis = new Map();
  const paramIndex = buildParameterIndex(yamlFiles);

  for (const { relativePath, doc } of rulesFiles) {
    const domain = doc.domain;
    if (!domain || !doc.rulesets) continue;

    const dir = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/') + 1) : '';

    for (const [rulesetName, ruleset] of Object.entries(doc.rulesets)) {
      const graph = compileRuleset(domain, rulesetName, ruleset, (ref) => resolve(ref, doc));
      graphs.set(`${dir}${domain}-${rulesetName}-graph.yaml`, graph);
    }

    // Beside the rules document, named for it: intake-rules.yaml documents
    // its endpoints in intake-rules-openapi.yaml.
    const api = generateRulesApi(domain, doc, paramIndex);
    if (api) apis.set(relativePath.replace(/\.yaml$/, '-openapi.yaml'), api);
  }

  return { graphs, apis };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toCamelCase(str) {
  return str.split('-').map((s, i) => i === 0 ? s : toPascalCase(s)).join('');
}


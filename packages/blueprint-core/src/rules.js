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
 *   3. Assemble the graph document (schema, domain, ruleset, outputs, inputs,
 *      facts, dependencies)
 *
 * Endpoint overlay generation follows the same pattern as compositions:
 * returns an OpenAPI Overlay 1.0.0 document that adds the POST endpoint and
 * a stub request/response schema to the domain's OpenAPI spec.
 */

// ── Input expansion ──────────────────────────────────────────────────────────

/**
 * Expand a ruleset's inputs map into JSONPath field-level graph input nodes.
 *
 * Each named input in the rules schema (e.g. household, policy) is an object
 * schema or $ref. The compiler walks each schema recursively and emits one
 * graph input node per reachable field, keyed by its JSONPath:
 *
 *   household.monthlyIncome (number)  →  $.household.monthlyIncome
 *   household.members (array)         →  $.household.members[]
 *   household.members[].age (integer) →  $.household.members[].age
 *
 * @param {Object} inputsMap - { inputName: schemaOrRef, ... }
 * @returns {Object} { [jsonPath]: nodeSpec }
 */
export function expandInputs(inputsMap) {
  const result = {};
  for (const [inputName, schema] of Object.entries(inputsMap || {})) {
    expandSchema(`$.${inputName}`, schema, result);
  }
  return result;
}

function expandSchema(prefix, schema, result) {
  if (!schema) return;

  if (schema.$ref) {
    // Cannot expand without resolving — emit a single opaque object node
    result[prefix] = { type: 'object' };
    return;
  }

  if (schema.type === 'object') {
    if (schema.properties) {
      for (const [field, fieldSchema] of Object.entries(schema.properties)) {
        expandSchema(`${prefix}.${field}`, fieldSchema, result);
      }
    } else {
      const node = { type: 'object' };
      if (schema.description) node.description = schema.description;
      result[prefix] = node;
    }
    return;
  }

  if (schema.type === 'array') {
    const arrayPath = `${prefix}[]`;
    const itemType = schema.items?.type ?? 'object';
    const node = { type: itemType };
    if (schema.description) node.description = schema.description;
    result[arrayPath] = node;

    if (schema.items?.properties) {
      for (const [field, fieldSchema] of Object.entries(schema.items.properties)) {
        expandSchema(`${arrayPath}.${field}`, fieldSchema, result);
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
 * ($.x.y[]) is the dependency that drives missing-input tracking.
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
    // the parent array path ($.household.members[]) is the real dependency.
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
    if (new RegExp(`\\b${factPath}\\b`).test(expression)) {
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

// ── Ruleset compiler ─────────────────────────────────────────────────────────

/**
 * Compile a single ruleset into a graph document.
 *
 * @param {string} domain       - domain name (e.g. 'eligibility')
 * @param {string} rulesetName  - ruleset key (e.g. 'expeditedSnap')
 * @param {Object} ruleset      - ruleset object from the rules file
 * @returns {Object} compiled graph document (ready to serialize as YAML)
 */
export function compileRuleset(domain, rulesetName, ruleset) {
  const expandedInputs = expandInputs(ruleset.inputs || {});
  const inputPaths = Object.keys(expandedInputs);

  const facts = {};
  const dependencies = {};
  const factPaths = [];

  for (const factDecl of ruleset.facts || []) {
    const { path: factPath, expression, description, type } = factDecl;

    // Build fact node
    const node = { expression };
    if (type) {
      // type may be a SchemaOrRef; for graph we only store the primitive type string
      const typeStr = typeof type === 'object' ? type.type : type;
      if (typeStr) node.type = typeStr;
    }
    if (description) node.description = description;
    facts[factPath] = node;

    // Extract dependencies (may reference previously declared facts)
    const deps = extractDeps(expression, inputPaths, factPaths);
    if (deps.length > 0) {
      dependencies[factPath] = deps;
    }

    factPaths.push(factPath);
  }

  // Determine outputs: prefer declared outputs keys, fall back to last fact
  const outputs = ruleset.outputs?.properties
    ? Object.keys(ruleset.outputs.properties)
    : factPaths.slice(-1);

  return {
    $schema: 'https://blueprint.codeforamerica.org/schemas/graph-schema.yaml',
    domain,
    ruleset: rulesetName,
    outputs,
    inputs: expandedInputs,
    facts,
    dependencies,
  };
}

// ── Endpoint overlay generation ──────────────────────────────────────────────

/**
 * Generate an OpenAPI overlay for all rulesets in a rules file that declare
 * an endpoint: block. Returns null if no rulesets have endpoints.
 *
 * @param {string} domain   - domain name
 * @param {Object} rulesDoc - parsed rules YAML document
 * @returns {Object|null} OpenAPI Overlay 1.0.0 document, or null
 */
export function generateRulesEndpointOverlay(domain, rulesDoc) {
  const apiSpecFile = `${domain}-openapi.yaml`;
  const pathsUpdate = {};
  const schemasUpdate = {};

  for (const [rulesetName, ruleset] of Object.entries(rulesDoc.rulesets || {})) {
    if (!ruleset.endpoint?.path) continue;

    const endpointPath = ruleset.endpoint.path;
    const pascal = toPascalCase(rulesetName);
    const requestSchemaName = `${pascal}Request`;
    const responseSchemaName = `${pascal}Response`;
    const operationId = `assess${pascal}`;

    // Request body: one property per named input, using the input schema
    const requestProperties = {};
    for (const [inputName, inputSchema] of Object.entries(ruleset.inputs || {})) {
      requestProperties[inputName] = inputSchema;
    }

    // Response: evaluation contract { resolved, missing, errors }
    // resolved contains the declared outputs; missing/errors are open objects
    const resolvedProperties = {};
    for (const [propName, propSchema] of Object.entries(ruleset.outputs?.properties || {})) {
      resolvedProperties[propName] = propSchema;
    }

    pathsUpdate[endpointPath] = {
      post: {
        summary: `Assess ${rulesetName}`,
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
          '400': { $ref: './components/responses.yaml#/BadRequest' },
          '500': { $ref: './components/responses.yaml#/InternalError' },
        },
      },
    };

    schemasUpdate[requestSchemaName] = {
      type: 'object',
      description: `Input data for ${rulesetName} evaluation. All fields are optional — partial inputs trigger partial evaluation.`,
      properties: requestProperties,
    };

    schemasUpdate[responseSchemaName] = {
      type: 'object',
      description: `Evaluation result for ${rulesetName}.`,
      required: ['resolved', 'missing', 'errors'],
      properties: {
        resolved: {
          type: 'object',
          description: 'Facts that were successfully computed.',
          properties: resolvedProperties,
        },
        missing: {
          type: 'object',
          description: 'For each unresolved output, the input paths needed to compute it.',
          additionalProperties: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        errors: {
          type: 'object',
          description: 'Facts that failed to evaluate and the reason.',
          additionalProperties: { type: 'string' },
        },
      },
    };
  }

  if (Object.keys(pathsUpdate).length === 0) return null;

  return {
    overlay: '1.0.0',
    info: {
      title: `${domain} Rules Overlay`,
      version: '1.0.0',
      description: `Auto-generated rules endpoints from ${domain}-rules.yaml`,
    },
    actions: [
      {
        target: '$.paths',
        file: apiSpecFile,
        description: `Add generated rules endpoints for ${domain}`,
        update: pathsUpdate,
      },
      {
        target: '$.components.schemas',
        file: apiSpecFile,
        description: `Add generated rules request/response schemas for ${domain}`,
        update: schemasUpdate,
      },
    ],
  };
}

/**
 * Compile all rules files and generate endpoint overlays.
 *
 * @param {Array<{ relativePath: string, doc: Object }>} rulesFiles
 * @returns {{ graphs: Map<string, Object>, overlays: Array<{ overlay: Object, domain: string }> }}
 */
export function generateRulesResults(rulesFiles) {
  const graphs = new Map();
  const overlays = [];

  for (const { relativePath, doc } of rulesFiles) {
    const domain = doc.domain;
    if (!domain || !doc.rulesets) continue;

    for (const [rulesetName, ruleset] of Object.entries(doc.rulesets)) {
      const graph = compileRuleset(domain, rulesetName, ruleset);
      const graphPath = `${domain}-${rulesetName}-graph.yaml`;
      graphs.set(graphPath, graph);
    }

    const overlay = generateRulesEndpointOverlay(domain, doc);
    if (overlay) {
      overlays.push({ overlay, domain });
    }
  }

  return { graphs, overlays };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toPascalCase(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

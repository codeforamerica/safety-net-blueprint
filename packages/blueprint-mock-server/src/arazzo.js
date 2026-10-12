/**
 * Run an Arazzo scenario against a fetch — the mock's, in a page or a test.
 *
 * An Arazzo document (OpenAPI Initiative, https://spec.openapis.org/arazzo/)
 * describes a sequence of API calls toward a goal: each step names an
 * operation, what to send, what makes it a success, and what to carry to later
 * steps. A contract set's scenarios run as tests, step through in the demo
 * page, and draw sequence diagrams, from one file.
 *
 * This runs the subset the blueprint's scenarios use, and refuses the rest by
 * name rather than skipping it, so a scenario never passes by not being
 * checked:
 *   - steps by `operationId`, found in the set's OpenAPI documents
 *   - `parameters` (path, query, header) and `requestBody.payload`
 *   - reusable parameters, `{ reference: $components.parameters.<name> }`
 *   - runtime expressions: $statusCode, $response.body#/<pointer>,
 *     $response.header.<name>, $steps.<id>.outputs.<name>, $inputs.<name>,
 *     whole or embedded in a string as {$…}
 *   - `successCriteria` simple conditions: ==, !=, <, <=, >, >= joined by &&
 *   - `outputs`
 * Standard enough that Redocly's Respect runs the same documents against a
 * served mock.
 */

const SUPPORTED_STEP_FIELDS = new Set(['stepId', 'description', 'operationId', 'parameters', 'requestBody', 'successCriteria', 'outputs']);

/**
 * Every operation in the set's OpenAPI documents, by operationId, with the
 * method and full path a request to it goes to.
 *
 * @param {Array<{ type: string, content: object }>} docs
 * @returns {Map<string, { method: string, path: string }>}
 */
export function operationIndex(docs) {
  const index = new Map();
  for (const doc of docs ?? []) {
    if (doc.type !== 'openapi') continue;
    const servers = doc.content?.servers ?? [];
    const local = servers.find((s) => /localhost|127\.0\.0\.1/.test(s.url)) ?? servers[0];
    let base = '';
    try { base = new URL(local?.url ?? '', 'http://relative.invalid').pathname.replace(/\/$/, ''); } catch { /* no base */ }
    for (const [path, item] of Object.entries(doc.content?.paths ?? {})) {
      for (const method of ['get', 'put', 'post', 'patch', 'delete']) {
        const id = item?.[method]?.operationId;
        if (id && !index.has(id)) index.set(id, { method: method.toUpperCase(), path: `${base}${path}` });
      }
    }
  }
  return index;
}

/** A JSON Pointer into a value: `/items/0/id`. */
function pointer(value, path) {
  if (!path) return value;
  return path.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((at, key) => (at == null ? undefined : at[key]), value);
}

/**
 * The value of a runtime expression.
 *
 * @param {string} expression - e.g. `$steps.start.outputs.id`
 * @param {object} scope - { inputs, steps, response }
 */
function evaluate(expression, scope) {
  if (expression === '$statusCode') return scope.response?.status;
  if (expression.startsWith('$response.body')) return pointer(scope.response?.body, expression.slice('$response.body'.length).replace(/^#/, ''));
  if (expression.startsWith('$response.header.')) return scope.response?.headers?.[expression.slice('$response.header.'.length).toLowerCase()];
  const steps = /^\$steps\.([^.]+)\.outputs\.(.+)$/.exec(expression);
  if (steps) return scope.steps[steps[1]]?.outputs?.[steps[2]];
  const inputs = /^\$inputs\.(.+)$/.exec(expression);
  if (inputs) return pointer(scope.inputs, `/${inputs[1].replace(/\./g, '/')}`);
  throw new Error(`Runtime expression ${expression} is not one this runner supports`);
}

/** A value with its runtime expressions resolved: whole (`$x`) or embedded (`a-{$x}`). */
function resolve(value, scope) {
  if (typeof value === 'string') {
    if (/^\$[a-zA-Z]/.test(value) && !value.includes(' ')) return evaluate(value, scope);
    if (value.includes('{$')) return value.replace(/\{(\$[^{}]+)\}/g, (_, e) => String(evaluate(e, scope) ?? ''));
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => resolve(v, scope));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, scope)]));
  return value;
}

/** One side of a simple condition: a runtime expression or a literal. */
function operand(text, scope) {
  const t = text.trim();
  if (t.startsWith('$')) return evaluate(t, scope);
  if (/^'.*'$/.test(t) || /^".*"$/.test(t)) return t.slice(1, -1);
  if (t === 'true' || t === 'false') return t === 'true';
  if (t === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  throw new Error(`Condition operand ${t} is not a runtime expression or a literal`);
}

/** A simple condition: comparisons joined by &&. */
function holds(condition, scope) {
  if (/\|\||[()]/.test(condition)) throw new Error(`Condition "${condition}" uses || or grouping, which this runner does not support`);
  return condition.split('&&').every((part) => {
    const m = /^(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+)$/.exec(part.trim());
    if (!m) throw new Error(`Condition "${part.trim()}" is not a comparison`);
    const [, l, op, r] = m;
    const a = operand(l, scope); const b = operand(r, scope);
    switch (op) {
      case '==': return a == b; // Arazzo compares loosely: a status of 201 equals "201"
      case '!=': return a != b;
      case '<': return a < b;
      case '<=': return a <= b;
      case '>': return a > b;
      default: return a >= b;
    }
  });
}

/**
 * Run each workflow of an Arazzo document, step by step.
 *
 * @param {object} arazzo - The document's content
 * @param {Object} options
 * @param {Function} options.fetch - `(Request) => Promise<Response>`
 * @param {Map} options.operations - From `operationIndex`
 * @param {object} [options.inputs] - Workflow inputs, by workflowId
 * @param {string} [options.origin] - Request origin, for building URLs
 * @param {Function} [options.onStep] - Called with each step's result as it finishes
 * @returns {Promise<Array<{ workflowId: string, passed: boolean, steps: object[] }>>}
 */
export async function runScenario(arazzo, { fetch, operations, inputs = {}, origin = 'http://localhost', onStep } = {}) {
  const components = arazzo.components ?? {};
  const results = [];

  for (const workflow of arazzo.workflows ?? []) {
    const scope = { inputs: inputs[workflow.workflowId] ?? {}, steps: {} };
    const run = { workflowId: workflow.workflowId, summary: workflow.summary, passed: true, steps: [] };
    results.push(run);

    for (const step of workflow.steps ?? []) {
      const unsupported = Object.keys(step).filter((k) => !SUPPORTED_STEP_FIELDS.has(k) && !k.startsWith('x-'));
      if (unsupported.length > 0) throw new Error(`Step ${step.stepId} uses ${unsupported.join(', ')}, which this runner does not support`);
      const operation = operations.get(step.operationId);
      if (!operation) throw new Error(`Step ${step.stepId} names operation ${step.operationId}, which no API in the set declares`);

      let path = operation.path;
      const query = new URLSearchParams();
      const headers = { 'content-type': 'application/json' };
      for (const raw of step.parameters ?? []) {
        const parameter = raw.reference
          ? components.parameters?.[raw.reference.replace(/^\$components\.parameters\./, '')]
          : raw;
        if (!parameter) throw new Error(`Step ${step.stepId} references ${raw.reference}, which the document's components do not declare`);
        const value = resolve(raw.value ?? parameter.value, scope);
        if (parameter.in === 'path') path = path.replace(`{${parameter.name}}`, encodeURIComponent(value));
        else if (parameter.in === 'query') query.set(parameter.name, value);
        else if (parameter.in === 'header') headers[parameter.name] = String(value);
        else throw new Error(`Step ${step.stepId}: parameter ${parameter.name} is in ${parameter.in}, which this runner does not support`);
      }
      const body = step.requestBody ? resolve(step.requestBody.payload, scope) : undefined;
      const url = `${origin}${path}${query.size ? `?${query}` : ''}`;

      const response = await fetch(new Request(url, {
        method: operation.method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }));
      const text = await response.text();
      let parsed = text;
      try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
      const responseHeaders = Object.fromEntries([...response.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
      const stepScope = { ...scope, response: { status: response.status, body: parsed, headers: responseHeaders } };

      const checks = (step.successCriteria ?? []).map((criterion) => {
        if (criterion.type && criterion.type !== 'simple') throw new Error(`Step ${step.stepId}: ${criterion.type} criteria are not supported`);
        return { condition: criterion.condition, passed: holds(criterion.condition, stepScope) };
      });
      const passed = checks.every((c) => c.passed);
      const outputs = passed
        ? Object.fromEntries(Object.entries(step.outputs ?? {}).map(([k, e]) => [k, resolve(e, stepScope)]))
        : {};
      scope.steps[step.stepId] = { outputs };

      const result = {
        stepId: step.stepId,
        description: step.description,
        operationId: step.operationId,
        request: { method: operation.method, url: `${path}${query.size ? `?${query}` : ''}`, headers, body },
        response: stepScope.response,
        checks,
        passed,
      };
      run.steps.push(result);
      onStep?.(result);
      // A failed step stops its workflow: later steps would act on what it
      // did not produce.
      if (!passed) { run.passed = false; break; }
    }
  }
  return results;
}

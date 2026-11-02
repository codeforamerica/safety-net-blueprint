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
 *   - steps by `operationId`, found in the set's OpenAPI documents or among
 *     the mock's own routes — qualified as `$sourceDescriptions.<name>.<id>`
 *     when the document names more than one source, as Arazzo requires
 *   - `parameters` (path, query, header) and `requestBody.payload`, sent as
 *     JSON or, for an upload, as multipart/form-data with its file parts as files
 *   - reusable parameters, `{ reference: $components.parameters.<name> }`
 *   - runtime expressions: $statusCode, $response.body#/<pointer>,
 *     $response.header.<name>, $steps.<id>.outputs.<name>, $inputs.<name>,
 *     whole or embedded in a string as {$…}
 *   - selectors (Arazzo 1.1), in outputs, parameter values and request
 *     bodies: `{ context, selector, type }`, where `type` is `jsonpath`
 *     (RFC 9535) or `jsonpointer` — to pick items out of a list by what they
 *     hold, not by where they sit. Arazzo doesn't say what a JSONPath gives;
 *     here its shape follows the query, as RFC 9535 sorts them: a singular
 *     query (names and indexes only, `$.items[0].id`) gives the value it
 *     names, and the step fails when there is none; any other (a filter, a
 *     wildcard) gives a list, which may be empty
 *   - `successCriteria` simple conditions: ==, !=, <, <=, >, >= joined by &&,
 *     and `jsonpath` conditions, which pass when they match anything
 *   - `outputs`
 *   - workflows that depend on earlier ones (`dependsOn`), reading what they
 *     produced as `$workflows.<id>.outputs.<name>` — a long scenario in
 *     sections, each a workflow, on the same server throughout
 *   - `onFailure` actions of type `retry`, with `retryAfter` (seconds) and
 *     `retryLimit` — for a step that checks what an asynchronous reaction
 *     does, which may not have happened the moment the step before it returns
 * Standard enough that Redocly's Respect runs the same documents against a
 * served mock.
 */

import { query as jsonPath } from 'jsonpath-rfc9535';
import parseJsonPath from 'jsonpath-rfc9535/parser';
import { CONTROL_OPERATIONS } from './platform-routes.js';

const SUPPORTED_STEP_FIELDS = new Set(['stepId', 'description', 'operationId', 'parameters', 'requestBody', 'successCriteria', 'outputs', 'onFailure']);

/**
 * Every operation in the set's OpenAPI documents, by operationId, with the
 * method and full path a request to it goes to.
 *
 * @param {Array<{ type: string, content: object }>} docs
 * @returns {Map<string, { method: string, path: string, multipart?: boolean, files?: string[] }>}
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
        if (!id || index.has(id)) continue;
        const entry = { method: method.toUpperCase(), path: `${base}${path}` };
        // An upload: which of its parts are files, so a step sends those as files.
        const form = item[method].requestBody?.content?.['multipart/form-data']?.schema;
        if (form) {
          const follow = (node) => (typeof node?.$ref === 'string' && node.$ref.startsWith('#/')
            ? node.$ref.slice(2).split('/').reduce((at, key) => at?.[key], doc.content) : node);
          const properties = follow(form)?.properties ?? {};
          entry.multipart = true;
          entry.files = Object.entries(properties).filter(([, p]) => follow(p)?.format === 'binary').map(([name]) => name);
        }
        index.set(id, entry);
      }
    }
  }
  return index;
}

/**
 * The mock's own routes — stubs, reset, reseed — as operations, by the
 * operationIds contracts/mock-openapi.yaml declares. A scenario that stands
 * the mock in for something, a scheduler say, calls them like any API's.
 *
 * @param {{ routes: Map<string, object> }} mock - From createMockServer
 * @returns {Map<string, { method: string, path: string }>}
 */
export function controlOperations(mock) {
  const index = new Map();
  for (const [key, operationId] of Object.entries(CONTROL_OPERATIONS)) {
    if (!mock?.routes?.has(key)) continue;
    const [method, path] = key.split(' ');
    index.set(operationId, { method, path });
  }
  return index;
}

/**
 * The operation a step names: `createTranscript`, or qualified by the source
 * it belongs to, `$sourceDescriptions.transcripts.createTranscript`.
 */
function operationOf(step, sources, operations) {
  const qualified = /^\$sourceDescriptions\.([^.]+)\.(.+)$/.exec(step.operationId ?? '');
  if (qualified) {
    if (!sources.has(qualified[1])) {
      throw new Error(`Step ${step.stepId} names source ${qualified[1]}, which the document's sourceDescriptions do not declare`);
    }
    return operations.get(qualified[2]);
  }
  return operations.get(step.operationId);
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
 * @param {object} scope - { inputs, steps, workflows, response }
 */
function evaluate(expression, scope) {
  if (expression === '$statusCode') return scope.response?.status;
  if (expression.startsWith('$response.body')) return pointer(scope.response?.body, expression.slice('$response.body'.length).replace(/^#/, ''));
  if (expression.startsWith('$response.header.')) return scope.response?.headers?.[expression.slice('$response.header.'.length).toLowerCase()];
  const steps = /^\$steps\.([^.]+)\.outputs\.(.+)$/.exec(expression);
  if (steps) return scope.steps[steps[1]]?.outputs?.[steps[2]];
  const workflows = /^\$workflows\.([^.]+)\.outputs\.(.+)$/.exec(expression);
  if (workflows) return scope.workflows?.[workflows[1]]?.[workflows[2]];
  const inputs = /^\$inputs\.(.+)$/.exec(expression);
  if (inputs) return pointer(scope.inputs, `/${inputs[1].replace(/\./g, '/')}`);
  throw new Error(`Runtime expression ${expression} is not one this runner supports`);
}

/** A selector's type: `jsonpath` or `jsonpointer`, written alone or with its version. */
function selectorTypeOf(type) {
  const name = typeof type === 'string' ? type : type?.type;
  const version = typeof type === 'string' ? undefined : type?.version;
  if (name === 'jsonpath' && (version === undefined || version === 'rfc9535')) return 'jsonpath';
  if (name === 'jsonpointer' && (version === undefined || version === 'rfc6901')) return 'jsonpointer';
  throw new Error(`Selector type ${JSON.stringify(type)} is not one this runner supports; use jsonpath (RFC 9535) or jsonpointer`);
}

/** An Arazzo 1.1 Selector Object: `{ context, selector, type }`. */
function isSelector(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.context === 'string' && typeof value.selector === 'string' && 'type' in value;
}

/** Thrown when a selector names a value that isn't there, so the step that used it fails. */
class NoMatch extends Error {}

/**
 * Whether a JSONPath is singular, in RFC 9535's sense: each segment a name or
 * an index, so it names at most one place.
 */
function isSingular(selector) {
  return parseJsonPath(selector).segments.every(({ type, node }) => type === 'ChildSegment'
    && (node.type === 'MemberNameShorthand'
      || (node.type === 'BracketedSelection' && node.selectors.length === 1
        && ['NameSelector', 'IndexSelector'].includes(node.selectors[0].type))));
}

/**
 * What a selector picks out of its context. A JSON Pointer or a singular
 * JSONPath gives the value it names, and naming nothing is an error; any other
 * JSONPath gives the list of what it matches, empty or not.
 */
function select({ context, selector, type }, scope) {
  const data = evaluate(context, scope);
  if (selectorTypeOf(type) === 'jsonpointer') {
    const value = pointer(data, selector);
    if (value === undefined) throw new NoMatch(`${selector} matched nothing in ${context}`);
    return value;
  }
  const nodes = jsonPath(data ?? null, selector);
  if (!isSingular(selector)) return nodes;
  if (nodes.length === 0) throw new NoMatch(`${selector} matched nothing in ${context}`);
  return nodes[0];
}

/** A value with its runtime expressions resolved: whole (`$x`) or embedded (`a-{$x}`). */
function resolve(value, scope) {
  if (isSelector(value)) return select(value, scope);
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
 * Whether a success criterion holds: a simple condition, or a JSONPath one,
 * which holds when it matches anything in its context.
 */
function meets(criterion, scope, step) {
  if (!criterion.type || criterion.type === 'simple') return holds(criterion.condition, scope);
  if (selectorTypeOf(criterion.type) !== 'jsonpath') throw new Error(`Step ${step.stepId}: jsonpointer is not a criterion type`);
  if (!criterion.context) throw new Error(`Step ${step.stepId}: a jsonpath criterion needs a context`);
  const condition = criterion.condition.replace(/\{(\$[^{}]+)\}/g, (_, e) => String(evaluate(e, scope) ?? ''));
  return jsonPath(evaluate(criterion.context, scope) ?? null, condition).length > 0;
}

/**
 * A body a step sends as multipart/form-data, as the parts it is made of. A
 * part the operation declares as a file (`format: binary`) is sent as one —
 * given as `{ fileName, contentType, content }`, or as its content alone — and
 * every other part as text.
 */
function formOf(payload, files) {
  const form = new FormData();
  for (const [name, value] of Object.entries(payload ?? {})) {
    if (files.includes(name)) {
      const file = value && typeof value === 'object' ? value : { content: value };
      form.append(name, new File([String(file.content ?? '')], file.fileName ?? `${name}.bin`, { type: file.contentType ?? 'application/octet-stream' }));
    } else {
      form.append(name, typeof value === 'string' ? value : JSON.stringify(value));
    }
  }
  return form;
}

/**
 * A run of an Arazzo document that goes a step at a time, on the same server
 * throughout — as a reader steps through one in a page, each step acting on
 * what the ones before it made.
 *
 * @param {object} arazzo - The document's content
 * @param {Object} options - As for runScenario
 * @returns {{ results: object[], next: Function, runUntil: Function, preview: Function, finished: Function }}
 *   `next()` runs the next step and returns its result, or null when there is
 *   none; `runUntil(until)` runs on to a step, or to the end; `preview(step)`
 *   says what a step would send, from what the steps before it produced;
 *   `results` are each workflow's run so far.
 */
export function startScenario(arazzo, { fetch, operations, inputs = {}, origin = 'http://localhost', onStep } = {}) {
  const components = arazzo.components ?? {};
  const sources = new Set((arazzo.sourceDescriptions ?? []).map((source) => source.name));
  const results = [];
  const queue = (arazzo.workflows ?? []).flatMap((workflow) => (workflow.steps ?? []).map((step) => ({ workflow, step })));
  const scopes = new Map();
  const workflowOutputs = {}; // each finished workflow's outputs, by workflowId
  const stopped = new Set(); // workflows a failed step stopped, or a failed dependency kept from running
  let position = 0;

  const scopeOf = (workflow) => {
    if (!scopes.has(workflow.workflowId)) {
      scopes.set(workflow.workflowId, { inputs: inputs[workflow.workflowId] ?? {}, steps: {}, workflows: workflowOutputs });
      results.push({ workflowId: workflow.workflowId, summary: workflow.summary, passed: true, steps: [] });
    }
    return scopes.get(workflow.workflowId);
  };

  // A workflow runs after the ones it depends on, which come before it in the
  // document; when one of them failed, it doesn't run, and fails too.
  const order = (arazzo.workflows ?? []).map((w) => w.workflowId);
  for (const workflow of arazzo.workflows ?? []) {
    for (const dependency of workflow.dependsOn ?? []) {
      if (!order.includes(dependency)) throw new Error(`Workflow ${workflow.workflowId} depends on ${dependency}, which the document does not declare`);
      if (order.indexOf(dependency) > order.indexOf(workflow.workflowId)) throw new Error(`Workflow ${workflow.workflowId} depends on ${dependency}, which comes after it; this runner runs workflows in order`);
    }
  }
  const blocked = (workflow) => (workflow.dependsOn ?? []).some((id) => stopped.has(id) || !(id in workflowOutputs));

  /** What a step sends, worked out from what the steps before it produced. */
  function requestOf(step, scope) {
    const unsupported = Object.keys(step).filter((k) => !SUPPORTED_STEP_FIELDS.has(k) && !k.startsWith('x-'));
    if (unsupported.length > 0) throw new Error(`Step ${step.stepId} uses ${unsupported.join(', ')}, which this runner does not support`);
    const operation = operationOf(step, sources, operations);
    if (!operation) throw new Error(`Step ${step.stepId} names operation ${step.operationId}, which no API in the set declares`);

    let path = operation.path;
    const query = new URLSearchParams();
    const multipart = step.requestBody?.contentType === 'multipart/form-data' || (!step.requestBody?.contentType && operation.multipart);
    const headers = multipart ? {} : { 'content-type': 'application/json' };
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
    return { operation, method: operation.method, path: `${path}${query.size ? `?${query}` : ''}`, headers, body, multipart };
  }

  async function next() {
    for (;;) {
      while (position < queue.length && stopped.has(queue[position].workflow.workflowId)) position += 1;
      if (position >= queue.length) return null;
      const { workflow } = queue[position];
      if (scopes.has(workflow.workflowId) || !blocked(workflow)) break;
      // Its dependency failed: it fails without running.
      scopeOf(workflow);
      results.find((r) => r.workflowId === workflow.workflowId).passed = false;
      stopped.add(workflow.workflowId);
    }
    const { workflow, step } = queue[position];
    position += 1;
    const scope = scopeOf(workflow);
    const request = requestOf(step, scope);
    const retry = retryOf(step);

    let stepScope;
    let checks;
    let passed;
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(new Request(`${origin}${request.path}`, {
        method: request.method,
        headers: request.headers,
        body: request.body === undefined ? undefined
          : request.multipart ? formOf(request.body, request.operation.files ?? []) : JSON.stringify(request.body),
      }));
      const text = await response.text();
      let parsed = text;
      try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
      const responseHeaders = Object.fromEntries([...response.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
      stepScope = { ...scope, response: { status: response.status, statusText: response.statusText, body: parsed, headers: responseHeaders } };

      checks = (step.successCriteria ?? []).map((criterion) => ({ condition: criterion.condition, passed: meets(criterion, stepScope, step) }));
      passed = checks.every((c) => c.passed);
      if (passed || !retry || attempt >= retry.limit) break;
      await new Promise((settle) => setTimeout(settle, retry.after * 1000));
    }
    // Outputs whose selector names a value that isn't there fail the step,
    // as a check that says which output.
    const outputsOf = (map, from, label) => {
      const values = {};
      for (const [name, expression] of Object.entries(map ?? {})) {
        try {
          values[name] = resolve(expression, from);
        } catch (error) {
          if (!(error instanceof NoMatch)) throw error;
          checks.push({ condition: `${label} ${name}: ${error.message}`, passed: false });
          passed = false;
          return {};
        }
      }
      return values;
    };
    const outputs = passed ? outputsOf(step.outputs, stepScope, 'output') : {};
    scope.steps[step.stepId] = { outputs };
    // A workflow's outputs, once its last step has passed, for the workflows
    // that depend on it.
    let finished = null;
    if (passed && step === workflow.steps.at(-1)) finished = outputsOf(workflow.outputs, scope, 'workflow output');

    const result = {
      workflowId: workflow.workflowId,
      stepId: step.stepId,
      description: step.description,
      operationId: step.operationId,
      request: { method: request.method, url: request.path, headers: request.headers, body: request.body, multipart: request.multipart },
      response: stepScope.response,
      checks,
      passed,
      outputs,
    };
    const run = results.find((r) => r.workflowId === workflow.workflowId);
    run.steps.push(result);
    onStep?.(result);
    // A failed step stops its workflow: later steps would act on what it did
    // not produce.
    if (!passed) { run.passed = false; stopped.add(workflow.workflowId); }
    else if (finished) workflowOutputs[workflow.workflowId] = finished;
    return result;
  }

  async function runUntil(until = null) {
    let result;
    while ((result = await next())) {
      if (until && result.workflowId === until.workflowId && result.stepId === until.stepId) break;
    }
    return results;
  }

  function preview(workflowId, step) {
    const workflow = (arazzo.workflows ?? []).find((w) => w.workflowId === workflowId);
    try {
      const { method, path, headers, body, multipart } = requestOf(step, scopes.get(workflowId) ?? { inputs: inputs[workflowId] ?? {}, steps: {}, workflows: workflowOutputs });
      return { method, url: path, headers, body, multipart };
    } catch {
      return null; // refers to a step that has not run
    }
  }

  return { results, next, runUntil, preview, finished: () => position >= queue.length };
}

/**
 * A step's retry, from its `onFailure` actions: how long to wait, in seconds,
 * and how many more times to try. Only `retry` is supported, and only without
 * `criteria`; any other action is refused by name.
 *
 * @param {object} step
 * @returns {{ after: number, limit: number } | null}
 */
function retryOf(step) {
  if (!step.onFailure) return null;
  let retry = null;
  for (const action of step.onFailure) {
    if (action.type !== 'retry') throw new Error(`Step ${step.stepId}: onFailure actions of type ${action.type} are not supported`);
    if (action.criteria) throw new Error(`Step ${step.stepId}: onFailure criteria are not supported`);
    retry = { after: action.retryAfter ?? 0, limit: action.retryLimit ?? 1 };
  }
  return retry;
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
 * @param {{ workflowId: string, stepId: string }} [options.until] - Stop after this step
 * @returns {Promise<Array<{ workflowId: string, passed: boolean, steps: object[] }>>}
 */
export async function runScenario(arazzo, { until, ...options } = {}) {
  return startScenario(arazzo, options).runUntil(until);
}

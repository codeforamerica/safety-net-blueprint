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
 *   - steps that run another workflow (`workflowId`), passing its inputs as
 *     parameters with no `in` and reading what it produced as
 *     `$outputs.<name>`; a workflow a step runs this way doesn't also run on
 *     its own
 *   - steps that send or receive a message (Arazzo 1.1): an AsyncAPI
 *     operation by `operationId`, or a channel by `channelPath`, with `action`
 *     `send` or `receive`, against the platform's events. Receiving takes the
 *     first event of the channel's type, heard on `streamEvents` since the run
 *     began and not taken by an earlier step, that meets the step's
 *     `successCriteria` (which is how it tells its event from another's of
 *     the same type), waiting up to `timeout`
 *     milliseconds (2000 when not given); `$message.payload#/<pointer>` reads
 *     it. Sending publishes one with `publishEvent`. A step's `dependsOn` may
 *     name steps before it, which have run by then. A channel reached through
 *     its document's own servers, such as a relay's, is refused
 * Standard enough that Redocly's Respect runs the same documents against a
 * served mock.
 */

import { query as jsonPath } from 'jsonpath-rfc9535';
import parseJsonPath from 'jsonpath-rfc9535/parser';
import { extract } from '@codeforamerica/blueprint-core/browser';
import { CONTROL_OPERATIONS } from './platform-routes.js';
import { operationsOf, messageChecker, recognize, socketPaths } from './asyncapi-messages.js';

/** The last part of a path or URL: what a source's URL and a document's path share. */
const fileName = (path) => (path ?? '').split(/[?#]/)[0].split('/').pop();

/** The key an operation has under the document it's in: `intake-openapi.yaml#createApplication`. */
const inFile = (path, id) => `${fileName(path)}#${id}`;

const SUPPORTED_STEP_FIELDS = new Set(['stepId', 'description', 'operationId', 'workflowId', 'channelPath', 'action', 'dependsOn', 'timeout', 'parameters', 'requestBody', 'successCriteria', 'outputs', 'onFailure']);

/** How long a `receive` step waits for its message when it gives no `timeout`, in milliseconds. */
const RECEIVE_TIMEOUT = 2000;

/**
 * Every operation in the set's OpenAPI documents, with the method and full
 * path a request to it goes to. Each is under its document's file name and
 * id, `intake-openapi.yaml#createApplication`, which is how a step qualified
 * by its source finds it; and under its bare id too when no other API has
 * that id, as core finds it (extract(docs, 'operations')).
 *
 * @param {Array<{ type: string, content: object, relativePath?: string }>} docs
 * @returns {Map<string, { method: string, path: string, multipart?: boolean, files?: string[] }>}
 */
export function operationIndex(docs) {
  const index = new Map();
  const found = extract((docs ?? []).filter((doc) => doc.relativePath), 'operations');
  for (const doc of docs ?? []) {
    if (doc.type !== 'openapi') continue;
    const servers = doc.content?.servers ?? [];
    const local = servers.find((s) => /localhost|127\.0\.0\.1/.test(s.url)) ?? servers[0];
    let base = '';
    try { base = new URL(local?.url ?? '', 'http://relative.invalid').pathname.replace(/\/$/, ''); } catch { /* no base */ }
    for (const [path, item] of Object.entries(doc.content?.paths ?? {})) {
      for (const method of ['get', 'put', 'post', 'patch', 'delete']) {
        const id = item?.[method]?.operationId;
        if (!id) continue;
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
        index.set(inFile(doc.relativePath ?? doc.path, id), entry);
        // A set with no paths to place it by is read as before: by id, first wins.
        const unique = found ? found.find(id).operation?.file === doc.relativePath : !index.has(id);
        if (unique) index.set(id, entry);
      }
    }
  }
  // AsyncAPI operations, by key, with the channel's address: for an events
  // document, the event type. Only by their document's name, since AsyncAPI
  // makes a key unique within its document only. A document with servers is
  // reached over its own connection, and its messages are recognized by
  // checking them against the contract.
  const check = messageChecker(docs ?? []);
  for (const doc of docs ?? []) {
    if (doc.type !== 'asyncapi') continue;
    const path = doc.relativePath ?? doc.path;
    const reached = (doc.content?.servers && Object.keys(doc.content.servers).length > 0) ? 'servers' : 'events';
    const described = operationsOf(doc.content);
    // Where the mock serves each channel, for a document reached over its own server.
    const sockets = reached === 'servers' ? socketPaths(doc.content) : null;
    for (const [key, operation] of Object.entries(doc.content?.operations ?? {})) {
      const channel = channelOf(doc.content, operation?.channel?.$ref);
      if (!channel) continue;
      const { messages } = described.get(key);
      index.set(inFile(path, key), {
        async: true, action: operation.action, address: channel.address, reached, document: path,
        ...(reached === 'servers' && { socket: sockets?.get(described.get(key).channel) ?? null }),
        messages: messages.map((m) => m.name),
        binary: messages.length > 0 && messages.every((m) => m.binary),
        recognize: (data) => recognize(check, path, messages, data),
      });
    }
    for (const [name, channel] of Object.entries(doc.content?.channels ?? {})) {
      const found = channelOf(doc.content, `#/channels/${name}`) ?? channel;
      index.set(`${fileName(path)}#/channels/${name}`, { async: true, address: found.address ?? name, reached, document: path });
    }
  }
  return index;
}

/**
 * A channel by its local `$ref`, with its address: its own, or, for a channel
 * that refers into another document, the name it's kept under, which for an
 * events document is the event type.
 */
function channelOf(content, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/channels/')) return null;
  const name = ref.slice('#/channels/'.length).replace(/~1/g, '/').replace(/~0/g, '~');
  const channel = content?.channels?.[name];
  if (!channel) return null;
  return { address: channel.address ?? name };
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
    index.set(inFile('mock-openapi.yaml', operationId), { method, path });
  }
  return index;
}

/**
 * The operation a step names: `createTranscript`, or qualified by the source
 * it belongs to, `$sourceDescriptions.transcripts.createTranscript`, which
 * is looked for in that source's document only.
 */
function operationOf(step, sources, operations) {
  const qualified = /^\$sourceDescriptions\.([^.]+)\.(.+)$/.exec(step.operationId ?? '');
  if (qualified) {
    const source = sources.get(qualified[1]);
    if (!source) {
      throw new Error(`Step ${step.stepId} names source ${qualified[1]}, which the document's sourceDescriptions do not declare`);
    }
    return operations.get(inFile(source.url, qualified[2]));
  }
  return operations.get(step.operationId);
}

/**
 * The channel a step's `channelPath` names: its source's URL and a JSON
 * Pointer to the channel, `{$sourceDescriptions.events.url}#/channels/<name>`,
 * as Arazzo writes an operationPath.
 */
function channelPathOf(step, sources, operations) {
  const m = /^\{\$sourceDescriptions\.([^.}]+)\.url\}#\/channels\/(.+)$/.exec(step.channelPath ?? '');
  if (!m) throw new Error(`Step ${step.stepId}: channelPath ${step.channelPath} is not {$sourceDescriptions.<name>.url}#/channels/<channel>`);
  const source = sources.get(m[1]);
  if (!source) throw new Error(`Step ${step.stepId} names source ${m[1]}, which the document's sourceDescriptions do not declare`);
  const name = m[2].replace(/~1/g, '/').replace(/~0/g, '~');
  return operations.get(`${fileName(source.url)}#/channels/${name}`);
}

/** A step that sends or receives a message (Arazzo 1.1), rather than calling an HTTP operation. */
const isMessageStep = (step) => step.action !== undefined || step.channelPath !== undefined;

/**
 * The events a run hears, read from the platform's event stream
 * (`streamEvents`, Server-Sent Events) from the start of the run, so a step
 * that receives an event finds it however soon after the step that caused it.
 * Each event is taken once, the first that fits, in the order they came.
 */
function eventReader({ fetch, origin, operations }) {
  const stream = operations.get('platform-events-openapi.yaml#streamEvents') ?? operations.get('streamEvents');
  const heard = [];
  const taken = new Set();
  const waiting = new Set();
  const abort = new AbortController();
  let opened = null;

  const hear = (event) => {
    heard.push(event);
    for (const wake of waiting) wake();
  };

  async function pump(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffered += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffered.indexOf('\n\n')) !== -1) {
          const block = buffered.slice(0, end);
          buffered = buffered.slice(end + 2);
          const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
          if (data) { try { hear(JSON.parse(data)); } catch { /* not an event */ } }
        }
      }
    } catch { /* the run closed the stream */ }
  }

  return {
    /** Start listening; resolves once the stream is open. */
    open() {
      opened ??= (async () => {
        if (!stream) throw new Error('A step receives a message, but no API in the set declares streamEvents to hear events by');
        const response = await fetch(new Request(`${origin}${stream.path}`, { headers: { accept: 'text/event-stream' }, signal: abort.signal }));
        if (!response.ok || !response.body) throw new Error(`streamEvents answered ${response.status}; a step that receives a message needs the event stream`);
        pump(response.body);
      })();
      return opened;
    },
    /**
     * The first event of a type, not yet taken, that `fits`, waiting up to
     * `timeout` milliseconds for one; and the last of that type that didn't
     * fit, to say why.
     */
    async take(type, timeout, fits = () => true) {
      let nearest = null;
      const find = () => heard.find((event) => {
        if (taken.has(event) || event.type !== type) return false;
        if (fits(event)) return true;
        nearest = event;
        return false;
      });
      let found = find();
      if (!found) {
        found = await new Promise((settle) => {
          const wake = () => { const event = find(); if (event) { done(); settle(event); } };
          const timer = setTimeout(() => { done(); settle(null); }, timeout);
          const done = () => { clearTimeout(timer); waiting.delete(wake); };
          waiting.add(wake);
        });
      }
      if (found) taken.add(found);
      return { event: found, nearest };
    },
    close() { abort.abort(); },
  };
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
 * @param {object} scope - { inputs, steps, workflows, response, message }
 */
function evaluate(expression, scope) {
  if (expression === '$statusCode') return scope.response?.status;
  if (expression.startsWith('$response.body')) return pointer(scope.response?.body, expression.slice('$response.body'.length).replace(/^#/, ''));
  if (expression.startsWith('$response.header.')) return scope.response?.headers?.[expression.slice('$response.header.'.length).toLowerCase()];
  // A message a step sent or received (Arazzo 1.1): its payload by JSON
  // Pointer, `$message.payload#/data/status`, or by name, `$message.payload.data.status`.
  if (expression.startsWith('$message.payload')) {
    const rest = expression.slice('$message.payload'.length);
    return pointer(scope.message?.payload, rest.startsWith('#') ? rest.slice(1) : rest.replace(/\./g, '/'));
  }
  if (expression.startsWith('$message.header.')) return scope.message?.headers?.[expression.slice('$message.header.'.length).toLowerCase()];
  const steps = /^\$steps\.([^.]+)\.outputs\.(.+)$/.exec(expression);
  if (steps) return scope.steps[steps[1]]?.outputs?.[steps[2]];
  // A workflow a step ran by workflowId: what it produced, in that step.
  const ran = /^\$outputs\.(.+)$/.exec(expression);
  if (ran) return scope.outputs?.[ran[1]];
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
export function startScenario(arazzo, { fetch, operations, inputs = {}, origin = 'http://localhost', onStep, WebSocket: Socket = globalThis.WebSocket } = {}) {
  const components = arazzo.components ?? {};
  const sources = new Map((arazzo.sourceDescriptions ?? []).map((source) => [source.name, source]));
  const results = [];
  // A workflow another step runs by workflowId runs there, with the inputs
  // that step gives it, and not on its own as well.
  const byId = new Map((arazzo.workflows ?? []).map((workflow) => [workflow.workflowId, workflow]));
  const called = new Set((arazzo.workflows ?? []).flatMap((workflow) => (workflow.steps ?? []).map((step) => step.workflowId).filter(Boolean)));
  const queue = (arazzo.workflows ?? []).filter((workflow) => !called.has(workflow.workflowId))
    .flatMap((workflow) => (workflow.steps ?? []).map((step) => ({ workflow, step })));
  const scopes = new Map();
  const workflowOutputs = {}; // each finished workflow's outputs, by workflowId
  const stopped = new Set(); // workflows a failed step stopped, or a failed dependency kept from running
  let position = 0;
  const events = eventReader({ fetch, origin, operations });
  // Each section's connection to each document reached over its own server,
  // opened by its first message step there.
  const connections = new Map();

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
    // A step's requestBody.contentType names the media type it sends, as
    // Arazzo says; a JSON body without one is application/json.
    const headers = multipart ? {} : { 'content-type': step.requestBody?.contentType ?? 'application/json' };
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

  // A run with a step that receives an event listens from before its first
  // step, so it hears what every step causes.
  const listens = (arazzo.workflows ?? []).some((workflow) => (workflow.steps ?? []).some((step) => step.action === 'receive'));

  async function next() {
    if (listens) await events.open();
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
    checkDependsOn(workflow, step);
    return finish(workflow, step, scope, await execute(workflow, step, scope));
  }

  /**
   * Run one step, in the section (a workflow the run takes in order) it's
   * part of, with what the steps before it produced: what it sent, the scope
   * its checks and outputs read, its checks, and whether it passed.
   */
  async function execute(section, step, scope) {
    if (step.workflowId !== undefined) return workflowStep(section, step, scope);
    if (isMessageStep(step)) return messageStep(step, scope, section);
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
        ...(step.timeout !== undefined && { signal: AbortSignal.timeout(step.timeout) }),
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
    return {
      request: { method: request.method, url: request.path, headers: request.headers, body: request.body, multipart: request.multipart },
      stepScope, checks, passed,
    };
  }

  /**
   * A step that runs another workflow (`workflowId`), as Arazzo describes:
   * its parameters, with no `in`, are the workflow's inputs, and what the
   * workflow produces is `$outputs.<name>` in the step's own checks and
   * outputs. Its steps run here, in this section, one after another, and a
   * failed one fails the step.
   */
  async function workflowStep(section, step, scope) {
    if (String(step.workflowId).startsWith('$')) throw new Error(`Step ${step.stepId}: a workflow in another Arazzo document isn't one this runner runs`);
    const workflow = byId.get(step.workflowId);
    if (!workflow) throw new Error(`Step ${step.stepId} runs workflow ${step.workflowId}, which the document does not declare`);
    const given = {};
    for (const raw of step.parameters ?? []) {
      const parameter = raw.reference ? components.parameters?.[raw.reference.replace(/^\$components\.parameters\./, '')] : raw;
      if (!parameter) throw new Error(`Step ${step.stepId} references ${raw.reference}, which the document's components do not declare`);
      if (parameter.in) throw new Error(`Step ${step.stepId}: a parameter passed to a workflow has no "in", as Arazzo says; ${parameter.name} has one`);
      given[parameter.name] = resolve(raw.value ?? parameter.value, scope);
    }
    const inner = { inputs: given, steps: {}, workflows: workflowOutputs };
    const steps = [];
    const checks = [];
    let passed = true;
    for (const each of workflow.steps ?? []) {
      checkDependsOn(workflow, each);
      const outcome = await execute(section, each, inner);
      let ok = outcome.passed;
      let outputs = ok ? collectOutputs(each.outputs, outcome.stepScope, 'output', outcome.checks) : {};
      if (outputs === null) { ok = false; outputs = {}; }
      inner.steps[each.stepId] = { outputs };
      steps.push({
        stepId: each.stepId, description: each.description, operationId: each.operationId,
        request: outcome.request, response: outcome.stepScope.response, ...(outcome.message && { message: outcome.message }),
        checks: outcome.checks, passed: ok, outputs,
      });
      if (!ok) {
        passed = false;
        checks.push({ condition: `${workflow.workflowId}: step ${each.stepId} passed`, passed: false });
        break;
      }
    }
    const produced = passed ? collectOutputs(workflow.outputs, inner, 'workflow output', checks) ?? {} : {};
    const stepScope = { ...scope, outputs: produced };
    if (passed) {
      for (const criterion of step.successCriteria ?? []) checks.push({ condition: criterion.condition, passed: meets(criterion, stepScope, step) });
    }
    return { request: { workflowId: workflow.workflowId, inputs: given }, stepScope, checks, passed: passed && checks.every((c) => c.passed), steps };
  }

  /**
   * Outputs, by their expressions, from a scope. One whose selector names a
   * value that isn't there is a failed check naming it, and gives null.
   */
  function collectOutputs(map, from, label, checks) {
    const values = {};
    for (const [name, expression] of Object.entries(map ?? {})) {
      try {
        values[name] = resolve(expression, from);
      } catch (error) {
        if (!(error instanceof NoMatch)) throw error;
        checks.push({ condition: `${label} ${name}: ${error.message}`, passed: false });
        return null;
      }
    }
    return values;
  }

  /**
   * A step that sends or receives a message. Receiving takes the first event
   * of the channel's type the run has heard, not yet taken, that meets the
   * step's successCriteria — so a step finds its own session's event among
   * others' — waiting up to the step's `timeout`; sending publishes one (`publishEvent`), with the
   * channel's type unless the payload gives its own.
   */
  async function messageStep(step, scope, workflow) {
    const request = messageOf(step, scope);
    const operation = step.channelPath ? channelPathOf(step, sources, operations) : operationOf(step, sources, operations);
    if (operation.reached === 'servers') return socketStep(step, scope, workflow, operation, request);
    if (request.action === 'receive') {
      await events.open();
      const timeout = step.timeout ?? RECEIVE_TIMEOUT;
      const checksOn = (event) => {
        const stepScope = { ...scope, message: { payload: event, headers: {} } };
        return { stepScope, checks: (step.successCriteria ?? []).map((criterion) => ({ condition: criterion.condition, passed: meets(criterion, stepScope, step) })) };
      };
      const fits = (event) => { try { return checksOn(event).checks.every((c) => c.passed); } catch { return false; } };
      const { event, nearest } = await events.take(request.channel, timeout, fits);
      if (!event) {
        const missed = { condition: `received ${request.channel}${step.successCriteria?.length ? ' meeting its criteria' : ''} within ${timeout} ms`, passed: false };
        // The nearest miss, so a failure says what came instead.
        if (nearest) {
          const { stepScope, checks } = checksOn(nearest);
          return { request, stepScope, checks: [missed, ...checks], passed: false, message: stepScope.message };
        }
        return { request, stepScope: scope, checks: [missed], passed: false };
      }
      const { stepScope, checks } = checksOn(event);
      const message = stepScope.message;
      return { request, stepScope, checks, passed: checks.every((c) => c.passed), message };
    }
    const publish = operations.get('platform-events-openapi.yaml#publishEvent') ?? operations.get('publishEvent');
    if (!publish) throw new Error(`Step ${step.stepId} sends a message, but no API in the set declares publishEvent to send it by`);
    const payload = { specversion: '1.0', source: 'arazzo', type: request.channel, ...request.body };
    const response = await fetch(new Request(`${origin}${publish.path}`, {
      method: publish.method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    }));
    const text = await response.text();
    let body = text;
    try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    const message = { payload, headers: {} };
    const stepScope = { ...scope, message, response: { status: response.status, statusText: response.statusText, body, headers: {} } };
    const checks = [{ condition: `sent ${request.channel}`, passed: response.ok },
      ...(step.successCriteria ?? []).map((criterion) => ({ condition: criterion.condition, passed: meets(criterion, stepScope, step) }))];
    return { request: { ...request, body: payload }, stepScope, checks, passed: checks.every((c) => c.passed), message };
  }

  /** What a message step sends or listens for: its action and channel, and a payload to send. */
  function messageOf(step, scope) {
    const unsupported = Object.keys(step).filter((k) => !SUPPORTED_STEP_FIELDS.has(k) && !k.startsWith('x-'));
    if (unsupported.length > 0) throw new Error(`Step ${step.stepId} uses ${unsupported.join(', ')}, which this runner does not support`);
    if (step.action !== 'send' && step.action !== 'receive') throw new Error(`Step ${step.stepId}: a message step's action is send or receive, not ${step.action}`);
    if (step.onFailure) throw new Error(`Step ${step.stepId}: onFailure on a message step is not supported`);
    if (step.parameters?.length) throw new Error(`Step ${step.stepId}: parameters on a message step are not supported`);
    const operation = step.channelPath ? channelPathOf(step, sources, operations) : operationOf(step, sources, operations);
    if (!operation) throw new Error(`Step ${step.stepId} names ${step.channelPath ?? step.operationId}, which no AsyncAPI document in the set declares`);
    if (!operation.async) throw new Error(`Step ${step.stepId} has an action, but ${step.operationId} is an HTTP operation`);
    if (operation.reached === 'servers' && !operation.recognize) {
      throw new Error(`Step ${step.stepId}: give a message step on a document reached over its own server by operationId, not channelPath, so the runner knows which message it is`);
    }
    const body = step.action === 'send' && step.requestBody ? resolve(step.requestBody.payload, scope) : undefined;
    return {
      action: step.action, channel: operation.address,
      ...(operation.reached === 'servers' && { message: operation.messages.join(' or '), document: operation.document }),
      ...(body !== undefined && { body }),
    };
  }

  /**
   * This section's connection to a document's server: the mock's WebSocket
   * for its channel, where its localhost server puts it, opened by the first step that sends on
   * it, and opened again by one that sends after it closed, as software
   * reconnects. A step that receives reads the latest, closed or not. What
   * arrives is kept in order, each frame taken once by a step that receives
   * it.
   */
  function connectionFor(workflow, operation, { sending = false } = {}) {
    const key = `${workflow.workflowId} ${operation.socket}`;
    const latest = connections.get(key);
    if (latest && !(sending && latest.closed)) return latest;
    if (!Socket) throw new Error(`A step sends or receives on ${fileName(operation.document)}, and there's no WebSocket to connect with; pass one`);
    if (!operation.socket) throw new Error(`${fileName(operation.document)} lists no localhost server, so the mock serves no WebSocket for it`);
    const url = new URL(operation.socket, origin.replace(/^http/, 'ws'));
    const socket = new Socket(url.href);
    socket.binaryType = 'arraybuffer';
    const connection = { socket, heard: [], taken: new Set(), waiting: new Set(), closed: null };
    const wake = () => { for (const fn of connection.waiting) fn(); };
    connection.opened = new Promise((settle) => {
      socket.addEventListener('open', () => settle(true));
      socket.addEventListener('close', () => settle(false));
    });
    // Kept as frames, not their text, so two alike are taken one at a time.
    socket.addEventListener('message', (event) => { connection.heard.push({ data: event.data }); wake(); });
    socket.addEventListener('close', (event) => { connection.closed = { code: event.code, reason: event.reason }; wake(); });
    connections.set(key, connection);
    return connection;
  }

  /** What a closed connection says, as a failed check. */
  const closedCheck = (connection) => ({ condition: `the connection is open (it closed: ${connection.closed.code} ${connection.closed.reason})`.trim(), passed: false });

  /**
   * A message step on a document reached over its own server: sending writes
   * a frame, binary for a binary message; receiving takes the first frame,
   * not yet taken, that is one of the operation's messages and meets the
   * step's successCriteria.
   */
  async function socketStep(step, scope, workflow, operation, request) {
    const connection = connectionFor(workflow, operation, { sending: request.action === 'send' });
    const open = await connection.opened;
    if (!open) return { request, stepScope: scope, checks: [closedCheck(connection)], passed: false };
    const payloadOf = (data) => (typeof data === 'string' ? JSON.parse(data) : null);

    if (request.action === 'send') {
      const data = operation.binary ? new TextEncoder().encode(String(request.body ?? '')) : JSON.stringify(request.body ?? {});
      const heardBefore = connection.heard.length;
      connection.socket.send(data);
      // Give the far end its turn. A message answered only by closing the
      // connection was refused; one answered and then closed, as a drop is,
      // was taken, and the steps that receive say what came.
      await new Promise((settle) => setTimeout(settle, 0));
      const refused = connection.closed && connection.heard.length === heardBefore;
      const message = { payload: operation.binary ? null : request.body ?? {}, headers: {} };
      const stepScope = { ...scope, message };
      const checks = [
        ...(refused ? [closedCheck(connection)] : []),
        ...(step.successCriteria ?? []).map((criterion) => ({ condition: criterion.condition, passed: meets(criterion, stepScope, step) })),
      ];
      return { request, stepScope, checks, passed: checks.every((c) => c.passed), message };
    }

    const timeout = step.timeout ?? RECEIVE_TIMEOUT;
    const checksOn = (data) => {
      const stepScope = { ...scope, message: { payload: payloadOf(data), headers: {} } };
      return { stepScope, checks: (step.successCriteria ?? []).map((criterion) => ({ condition: criterion.condition, passed: meets(criterion, stepScope, step) })) };
    };
    const fits = (data) => {
      if (!operation.recognize(data).message) return false;
      try { return checksOn(data).checks.every((c) => c.passed); } catch { return false; }
    };
    const find = () => connection.heard.find((frame) => !connection.taken.has(frame) && fits(frame.data));
    let frame = find();
    if (frame === undefined && !connection.closed) {
      frame = await new Promise((settle) => {
        const wake = () => {
          const found = find();
          if (found !== undefined || connection.closed) { done(); settle(found); }
        };
        const timer = setTimeout(() => { done(); settle(undefined); }, timeout);
        const done = () => { clearTimeout(timer); connection.waiting.delete(wake); };
        connection.waiting.add(wake);
      });
    }
    if (frame === undefined) {
      const checks = [{ condition: `received ${request.message} within ${timeout} ms`, passed: false }];
      if (connection.closed) checks.push(closedCheck(connection));
      return { request, stepScope: scope, checks, passed: false };
    }
    connection.taken.add(frame);
    const { stepScope, checks } = checksOn(frame.data);
    return { request, stepScope, checks, passed: checks.every((c) => c.passed), message: stepScope.message };
  }

  /** A step's `dependsOn` names steps before it in its workflow, which have run by the time it does. */
  function checkDependsOn(workflow, step) {
    for (const id of step.dependsOn ?? []) {
      const at = workflow.steps.findIndex((s) => s.stepId === id);
      if (at === -1 || at >= workflow.steps.indexOf(step)) {
        throw new Error(`Step ${step.stepId} depends on ${id}, which isn't a step before it in workflow ${workflow.workflowId}; this runner runs steps in order`);
      }
    }
  }

  /** A step's outputs, its result, and what it means for its workflow. */
  function finish(workflow, step, scope, { request, stepScope, checks, passed, message, steps }) {
    // Outputs whose selector names a value that isn't there fail the step,
    // as a check that says which output.
    const outputsOf = (map, from, label) => {
      const values = collectOutputs(map, from, label, checks);
      if (values === null) { passed = false; return {}; }
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
      ...(step.channelPath && { channelPath: step.channelPath }),
      request,
      response: stepScope.response,
      ...(message && { message }),
      // A step that ran a workflow: each of its steps.
      ...(steps && { steps }),
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
    const scope = scopes.get(workflowId) ?? { inputs: inputs[workflowId] ?? {}, steps: {}, workflows: workflowOutputs };
    try {
      if (step.workflowId !== undefined) return { workflowId: step.workflowId };
      if (isMessageStep(step)) return messageOf(step, scope);
      const { method, path, headers, body, multipart } = requestOf(step, scope);
      return { method, url: path, headers, body, multipart };
    } catch {
      return null; // refers to a step that has not run
    }
  }

  return { results, next, runUntil, preview, finished: () => position >= queue.length,
    close: () => {
      events.close();
      for (const { socket } of connections.values()) socket.close();
    },
  };
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
  const run = startScenario(arazzo, options);
  try {
    return await run.runUntil(until);
  } finally {
    run.close();
  }
}

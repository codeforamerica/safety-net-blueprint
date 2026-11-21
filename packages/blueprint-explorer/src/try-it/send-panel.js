/**
 * Trying requests on an API reference page, sent to the mock running in the
 * page.
 *
 * The page renders as plain reference first. Its `mock/mock.js` and
 * `mock/contracts.js` load deferred, then this boots the mock in the
 * background, restoring the records earlier pages left (records.js).
 *
 * Beside each operation's docs, a column holds the request, ready to send
 * once the operation is open: a box for each parameter, path ids filled from
 * the records the mock holds, an Example list, and the request as curl or as
 * a call through the generated TypeScript client, whose body is edited in
 * place. Send sits in that code, and what comes back is the first of the
 * response tabs, beside the documented ones. A rules endpoint has a third
 * tab, the client's local evaluation, which Run evaluates in the page. Who is calling is one setting
 * for the page, shown and changed in any operation. The control panel
 * (control-panel.js) shows the page's mock and starts it over.
 */

import { extract } from '@codeforamerica/blueprint-core/browser';
import { evaluate } from '@codeforamerica/blueprint-rules-engine';
import { loadResults, saveResults } from './records.js';
import { startMock } from './start-mock.js';
import { logRequest } from './activity.js';
import { hostMock, mockChanged } from './control-panel.js';
import { combobox, COMBO_STYLE } from './combobox.js';

const ORIGIN = 'http://mock.invalid';
const MANAGED = new Set(['id', 'createdAt', 'updatedAt', 'status', '_links']);

const el = (tag, text = '', className = '') => {
  const node = document.createElement(tag);
  if (text !== '') node.textContent = text;
  if (className) node.className = className;
  return node;
};

/** The server prefix an OpenAPI document's paths hang off, as the mock serves them. */
const basePathOf = (doc) => {
  const servers = doc.content?.servers ?? [];
  const local = servers.find((s) => /localhost|127\.0\.0\.1/.test(s.url)) ?? servers[0];
  try { return new URL(local?.url ?? '', 'http://relative.invalid').pathname.replace(/\/$/, ''); } catch { return ''; }
};

/** The server a snippet calls: the contract's own, preferring a local one, as the mock server serves it. */
const serverOf = (doc) => {
  const servers = doc.content?.servers ?? [];
  return ((servers.find((s) => /localhost|127\.0\.0\.1/.test(s.url)) ?? servers[0])?.url ?? '').replace(/\/$/, '');
};

/** The namespace the generated client exports a document's operations under: its API's name, camelCased. */
const namespaceOf = (doc) => (doc.api ?? '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/** TypeScript to write as it is, not as a value: a variable's name. */
class Code { constructor(code) { this.code = code; } }

/** A value as TypeScript source: names unquoted where they can be, strings in single quotes. */
const tsValue = (value, indent = '') => {
  const inner = `${indent}  `;
  if (value instanceof Code) return value.code;
  if (Array.isArray(value)) {
    return value.length ? `[\n${value.map((v) => inner + tsValue(v, inner)).join(',\n')},\n${indent}]` : '[]';
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return '{}';
    const key = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k.replace(/'/g, "\\'")}'`);
    return `{\n${entries.map(([k, v]) => (v instanceof Code && v.code === k ? `${inner}${k}` : `${inner}${key(k)}: ${tsValue(v, inner)}`)).join(',\n')},\n${indent}}`;
  }
  return typeof value === 'string' ? `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : JSON.stringify(value);
};

/** A word for a shell, in single quotes. */
const shellQuote = (text) => `'${String(text).replace(/'/g, `'\\''`)}'`;

/**
 * The same request written two ways, for running it somewhere other than
 * this page: curl, and a call through the generated TypeScript client.
 * With `bodyMark`, the body is left as that mark, for the page to put an
 * editable body in its place.
 */
const snippets = ({ doc, method, operationId, request, bodyMark, local, constants = new Map(), exampleQuery = null }) => {
  const { path, query, headers, body, type } = request;
  const parsed = (() => { try { return body === undefined ? undefined : JSON.parse(body); } catch { return undefined; } })();
  const namespace = namespaceOf(doc);
  // A parameter whose values the client exports as a constant is set from
  // it, in a variable of its own, with the choices beside it.
  const lead = [];
  const fromConstants = (where, values) => Object.fromEntries(Object.entries(values).map(([name, value]) => {
    const constant = constants.get(`${where}:${name}`);
    const placeholder = /^<.*>$/.test(value);
    if (!constant || (!placeholder && !constant.values.includes(value))) return [name, value];
    const at = `${namespace}.${constant.name}`;
    lead.push(`// ${name} is one of ${at}: ${constant.values.map(constKey).join(', ')}`,
      `const ${name} = ${at}.${constKey(placeholder ? constant.values[0] : value)};`);
    return [name, new Code(name)];
  }));
  // A search is easier built with the client's helpers than written by hand.
  if (exampleQuery) lead.push(`// To search, build q with the client's helpers, like:`, `// import { q, search } from './generated';`, `// q(${exampleQuery})`, '');
  const pathArgs = fromConstants('path', path);
  const queryArgs = fromConstants('query', query);
  const args = [];
  if (Object.keys(path).length) args.push(`path: ${tsValue(pathArgs, '  ')}`);
  if (Object.keys(query).length) args.push(`query: ${tsValue(queryArgs, '  ')}`);
  if (Object.keys(headers).length) args.push(`headers: ${tsValue(headers, '  ')}`);
  if (body !== undefined) args.push(`body: ${bodyMark ?? (parsed === undefined ? body.trim() : tsValue(parsed, '  '))}`);
  const typescript = `import { ${namespace} } from './generated'; // where you generated the client

${lead.length ? `${lead.join('\n').replace(/\n+$/, '')}\n\n` : ''}const response = await ${namespace}.${operationId}(${args.length ? `{\n${args.map((a) => `  ${a},`).join('\n')}\n}` : ''});`;

  const filled = Object.entries(path).reduce((at, [name, value]) => at.replace(`{${name}}`, /^<.*>$/.test(value) ? value : encodeURIComponent(value)), request.template);
  const search = new URLSearchParams(query).toString();
  const lines = [`curl${method === 'GET' ? '' : ` -X ${method}`} ${shellQuote(serverOf(doc) + filled + (search ? `?${search}` : ''))}`];
  for (const [name, value] of Object.entries(headers)) lines.push(`  -H ${shellQuote(`${name}: ${value}`)}`);
  if (body !== undefined) {
    lines.push(`  -H ${shellQuote(`Content-Type: ${type}`)}`);
    lines.push(`  -d ${bodyMark ? `'${bodyMark}'` : shellQuote(parsed === undefined ? body : JSON.stringify(parsed, null, 2))}`);
  }
  const written = { typescript, curl: lines.join(' \\\n') };
  // A ruleset's evaluation, run in the caller's own code by the client.
  if (local) {
    written.local = `import { ${local.namespace} } from './generated'; // where you generated the client

const result = ${local.namespace}.Rules.${local.ruleset}.evaluate(${bodyMark ?? (parsed === undefined ? (body ?? '{}').trim() : tsValue(parsed))});`;
  }
  return written;
};

/**
 * The ruleset an operation evaluates, when it is a rules endpoint: the
 * domain's rules document names the path, and the compiled graph is what the
 * client's `Rules.<ruleset>.evaluate` runs. Null for any other operation.
 */
const rulesetOf = (docs, op) => {
  const domain = op.doc.content?.info?.['x-domain'];
  const template = op.path.slice(basePathOf(op.doc).length);
  for (const doc of docs) {
    if (doc.content?.domain !== domain || !doc.content?.rulesets) continue;
    for (const [name, ruleset] of Object.entries(doc.content.rulesets)) {
      if (ruleset?.endpoint?.path !== template) continue;
      const graph = docs.find((d) => d.type === 'graph' && d.content?.domain === domain && d.content?.ruleset === name)?.content;
      if (graph) return { name, graph, namespace: domain.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) };
    }
  }
  return null;
};

const STREAM_MS = 3000;

/** What a streamed response sends in its first `ms`, after which it is closed. */
const firstOf = async (response, ms) => {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const stop = setTimeout(() => reader.cancel().catch(() => {}), ms);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } catch { /* closed */ }
  clearTimeout(stop);
  return text;
};

/** A value's key in the client's constant for its enum: in_person → IN_PERSON. */
const constKey = (value) => String(value).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * The constant the generated client exports for a parameter's values: a
 * string enum its schema references by name, such as
 * `ApplicationReviewSections`. Null for any other parameter, or one whose
 * name can't be a variable.
 */
const enumConstantOf = (doc, param) => {
  const ref = param?.schema?.$ref;
  if (typeof ref !== 'string' || !ref.startsWith('#/components/schemas/') || !/^[A-Za-z_$][\w$]*$/.test(param.name)) return null;
  const schema = local(doc, param.schema);
  return schema?.type === 'string' && Array.isArray(schema.enum) && schema.enum.length
    ? { name: ref.split('/').pop(), values: schema.enum.map(String) }
    : null;
};

/**
 * An example search for an operation that takes `q`, written with the
 * client's helpers: a field of the listed resource with fixed values, and a
 * date-time one, so it shows two helpers combined. Placeholders when the
 * resource has neither. Null when the operation takes no `q`.
 */
const exampleSearch = (doc, op, takesQ) => {
  if (!takesQ) return null;
  const listed = local(doc, op.operation.responses?.['200']?.content?.['application/json']?.schema);
  const item = local(doc, propertiesOf(doc, listed).items?.items);
  const fields = Object.entries(propertiesOf(doc, item)).map(([name, schema]) => [name, local(doc, schema) ?? {}]);
  const fixed = fields.find(([, schema]) => schema.type === 'string' && Array.isArray(schema.enum) && schema.enum.length);
  const dated = fields.find(([, schema]) => schema.type === 'string' && schema.format === 'date-time');
  const parts = [
    ...(fixed ? [`search.eq('${fixed[0]}', '${fixed[1].enum[0]}')`] : []),
    ...(dated ? [`search.gte('${dated[0]}', '2024-01-01')`] : []),
  ];
  return parts.length ? parts.join(', ') : `search.eq('<field>', '<value>')`;
};

/** A schema's properties, through `allOf` and same-document `$ref`s. */
const propertiesOf = (doc, schema, seen = new Set()) => {
  const node = local(doc, schema);
  if (!node || typeof node !== 'object' || seen.has(node)) return {};
  seen.add(node);
  return Object.assign({}, ...(node.allOf ?? []).map((part) => propertiesOf(doc, part, seen)), node.properties ?? {});
};

/** A same-document `$ref`, followed; anything else as it is. */
const local = (doc, node) => (typeof node?.$ref === 'string' && node.$ref.startsWith('#/')
  ? node.$ref.slice(2).split('/').reduce((at, key) => at?.[key], doc.content) : node);

/** The operation an element names, with its document, method and served path. */
const operationFor = (docs, file, operationId) => {
  const doc = docs.find((d) => d.type === 'openapi' && d.relativePath === file);
  for (const [path, item] of Object.entries(doc?.content?.paths ?? {})) {
    for (const method of ['get', 'put', 'post', 'patch', 'delete']) {
      if (item?.[method]?.operationId === operationId) {
        return { doc, method: method.toUpperCase(), path: basePathOf(doc) + path, operation: item[method], item };
      }
    }
  }
  return null;
};

/**
 * The fields a request schema accepts, through `allOf`, `oneOf`, `anyOf`
 * and same-document `$ref`s, leaving out read-only ones. A reference to
 * another document is passed over; null when no field is named.
 */
const fieldsOf = (doc, schema, seen = new Set()) => {
  const node = local(doc, schema);
  if (!node || typeof node !== 'object' || seen.has(node)) return null;
  seen.add(node);
  const names = new Set(Object.entries(node.properties ?? {})
    .filter(([, property]) => !local(doc, property)?.readOnly).map(([name]) => name));
  for (const part of [...(node.allOf ?? []), ...(node.oneOf ?? []), ...(node.anyOf ?? [])]) {
    for (const name of fieldsOf(doc, part, seen) ?? []) names.add(name);
  }
  return names.size ? names : null;
};

/** The schema an operation's success response is a record of, by name. */
const resourceOf = (op) => {
  for (const code of ['201', '200']) {
    const ref = op.operation.responses?.[code]?.content?.['application/json']?.schema?.$ref;
    if (typeof ref === 'string' && ref.startsWith('#/components/schemas/')) return ref.split('/').pop();
  }
  return null;
};

/** A record kept to what a request may send: no server-managed fields, only those the request names. */
const trimmed = (record, fields) => Object.fromEntries(Object.entries(record ?? {})
  .filter(([key]) => !MANAGED.has(key) && (!fields || fields.has(key))));

/** The JSON media type a request body is sent as, if it has one. */
const mediaTypeOf = (op) => Object.keys(op.operation.requestBody?.content ?? {}).find((type) => /[/+]json$/.test(type));

/**
 * The bodies a request can start with: the operation's own examples, then
 * each sample record of the resource it writes — from the mock data, or the
 * config catalog the mock is loaded from — kept to the fields the
 * request accepts, then an empty object. An update with no examples of its
 * own starts from the record its path names instead, fetched when it is
 * picked (`fromRecord`). A JSON Patch starts as an empty list of changes.
 */
const startingBodies = (docs, examples, op) => {
  const type = mediaTypeOf(op);
  const json = type && op.operation.requestBody.content[type];
  if (!json) return [];
  if (json.examples) {
    return Object.entries(json.examples).map(([name, example]) => ({ name: local(op.doc, example)?.summary ?? name, value: local(op.doc, example)?.value }));
  }
  if (json.example !== undefined) return [{ name: 'Example', value: json.example }];
  if (type === 'application/json-patch+json') return [{ name: 'Empty', value: [] }];
  // A rules endpoint: the ruleset's own examples, from its examples document.
  const ruleset = rulesetOf(docs, op);
  if (ruleset) {
    const domain = op.doc.content?.info?.['x-domain'];
    const declared = docs.flatMap((doc) => (doc.content?.domain === domain ? doc.content?.rulesets?.[ruleset.name]?.examples ?? [] : []));
    const listed = declared.filter((example) => example?.inputs).map((example, i) => ({ name: example.description ?? `Example ${i + 1}`, value: example.inputs }));
    if (listed.length) return [...listed, { name: 'Empty', value: {} }];
  }
  const fields = fieldsOf(op.doc, json.schema);
  if (op.method === 'PATCH' || op.method === 'PUT') return [{ name: 'The record', fromRecord: true, fields }];
  const resource = resourceOf(op);
  const samples = [
    ...(examples.records[resource] ?? []).map((example) => ({ name: example.key, value: example.data })),
    ...(examples.config[resource] ?? []).map((entry) => ({ name: entry.name ?? entry.id, value: entry })),
  ].map((sample) => ({ ...sample, value: trimmed(sample.value, fields) }))
    .filter((sample) => Object.keys(sample.value).length > 0);
  return samples.length ? samples : [{ name: 'Empty', value: {} }];
};


const STYLE = `
  /* Two views of an operation. With Try it off, the doc view: the reference,
     and the call as code beside it; the means to send it go. */
  html:not([data-try-it="on"]) .try-params, html:not([data-try-it="on"]) .try-body,
  html:not([data-try-it="on"]) .try-code .foot, html:not([data-try-it="on"]) .resp-tab.sent,
  html:not([data-try-it="on"]) .try-docs { display: none; }
  /* With it on, the Try it view: one column the card's width, the request,
     Send and the response; the docs folded under its description, opened
     on asking; what it set off in the control panel. */
  html[data-try-it="on"] .trying .op-body { grid-template-columns: minmax(0, 1fr) !important; }
  html[data-try-it="on"] .trying:not(.docs-open) .op-docs > :not(.op-desc):not(.try-docs) { display: none; }
  html[data-try-it="on"] .trying:not(.docs-open) .resp-tab:not(.sent),
  html[data-try-it="on"] .trying:not(.docs-open) .resp-panel:not([data-resp="sent"]):not([data-resp="local"]),
  html[data-try-it="on"] .trying:not(.docs-open) .responses-section:not(:has(.resp-tab.sent)) { display: none; }
  .try-docs { font: 600 12px system-ui, sans-serif; color: #2B1A78; background: none; border: 0; padding: 4px 0; cursor: pointer; }
  .try-params .row { display: grid; grid-template-columns: minmax(7rem, auto) 1fr; gap: 8px; align-items: center; padding: 3px 0; }
  .try-params label { font: 600 12px monospace; color: #333; }
  .try-params label span { font: 400 11px sans-serif; color: #888; margin-left: 4px; }
  .try-params input, .try-body textarea, .try-body select { font: 12px monospace; padding: 4px 6px; border: 1px solid #c7c4ea; border-radius: 4px; width: 100%; box-sizing: border-box; background: #fff; }
  .try-body textarea { min-height: 9rem; resize: vertical; }
  .try-body .pick { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; font-size: 11px; color: #555; }
  .try-body .pick select { width: auto; max-width: 100%; min-width: 0; flex: 0 1 auto; }
  .try-code .foot { display: flex; justify-content: flex-end; padding: 6px 8px; background: #1e1b3a; border-top: 1px solid #2f2a5c; }
  .try-code .send { font: 600 12px sans-serif; padding: 4px 16px; border-radius: 4px; border: 0; background: #fff; color: #2B1A78; cursor: pointer; }
  .try-code .send:disabled { opacity: .5; cursor: default; }
  .resp-tab.sent { font-family: sans-serif; }
  .resp-panel .sent-status { font-weight: 700; } .resp-panel .sent-status.ok { color: #15803d; } .resp-panel .sent-status.bad { color: #b42318; }
  .resp-panel .sent-headers { margin: 4px 0 0; font: 11px monospace; color: #555; }
  .resp-panel .sent-headers div { white-space: pre-wrap; word-break: break-all; }
  .resp-panel pre.sent-body { margin: 6px 0 0; padding: 8px 10px; background: #fff; border: 1px solid #eee; border-radius: 4px; max-height: 22rem; overflow: auto; white-space: pre-wrap; font-size: 11px; }
  .try-code { border: 1px solid #e3e1f5; border-radius: 4px; overflow: hidden; }
  .try-code .tabs { display: flex; align-items: center; gap: 2px; padding: 4px 6px; background: #f6f5fd; border-bottom: 1px solid #e3e1f5; font-size: 11px; }
  .try-code .tabs button { font: 600 11px sans-serif; padding: 3px 10px; border: 0; border-radius: 3px; background: transparent; color: #555; cursor: pointer; }
  .try-code .tabs button.on { background: #2B1A78; color: #fff; }
  .try-code .tabs .target { margin-left: auto; color: #777; font: 11px monospace; }
  .try-code .tabs button.copy { margin-left: 8px; border: 1px solid #c7c4ea; background: #fff; }
  .try-code pre { margin: 0; padding: 10px 12px; background: #1e1b3a; color: #e6e4f5; font: 11.5px/1.5 monospace; overflow: auto; max-height: 24rem; white-space: pre; }
  .try-params .caller-boxes { display: flex; gap: 6px; }
  .try-params .caller-boxes select { width: auto; }
`;

/**
 * @param {{ contracts: object, version: string, scope: string }} options
 */
export async function mountSendPanels({ contracts, version, scope }) {
  const holders = [...document.querySelectorAll('[data-try-op]')];
  if (!holders.length) return;
  document.head.append(Object.assign(el('style'), { textContent: STYLE + COMBO_STYLE }));
  // An operation's responses as its view has them: what was sent, in the Try
  // it view; the documented ones, in the doc view.
  const showAnswers = (holder) => {
    const asTried = trying();
    const section = holder.querySelector('.responses-section');
    const tab = section?.querySelector(asTried ? '.resp-tab.sent' : '.resp-tab:not(.sent)');
    if (tab && !tab.classList.contains('on')) tab.click();
  };
  // Try it turned off: bodies are read, not edited, and each operation shows
  // its documented responses again rather than what was sent.
  const trying = () => document.documentElement.dataset.tryIt === 'on';
  const followTryIt = () => {
    for (const body of document.querySelectorAll('.try-code .body-edit')) body.contentEditable = trying() ? 'plaintext-only' : 'false';
    for (const holder of document.querySelectorAll('[data-try-op]')) showAnswers(holder);
  };
  new MutationObserver(followTryIt).observe(document.documentElement, { attributes: true, attributeFilter: ['data-try-it'] });

  const docs = extract(contracts, 'docs');
  const examples = { records: extract(docs, 'examples'), config: {} };
  for (const { catalogs } of extract(docs, 'config')) {
    for (const { resourceName, entries } of Object.values(catalogs ?? {})) {
      (examples.config[resourceName] ??= []).push(...(entries ?? []));
    }
  }
  const records = { scope, version };
  // What each operation last sent and got back, as this page was left.
  const results = loadResults(records);
  const roles = docs.find((d) => Array.isArray(d.content?.$defs?.RoleType?.enum))?.content.$defs.RoleType.enum ?? [];
  const caller = { id: 'the-explorer', role: '' };
  const callerHeaders = () => ({
    ...(caller.id.trim() ? { 'X-Caller-Id': caller.id.trim() } : {}),
    ...(caller.role ? { 'X-Caller-Roles': caller.role } : {}),
  });

  const refreshers = [];
  const refreshAll = () => { for (const refresh of refreshers) refresh(); };

  // Who is calling: one caller for the page, set from any operation.
  const callerRows = [];
  const callerRow = () => {
    const id = Object.assign(el('input'), { type: 'text', value: caller.id, autocomplete: 'off' });
    id.setAttribute('aria-label', 'Caller id');
    const role = el('select');
    role.append(Object.assign(el('option', 'no role'), { value: '' }), ...roles.map((r) => Object.assign(el('option', r), { value: r })));
    role.value = caller.role;
    const sync = () => {
      caller.id = id.value;
      caller.role = role.value;
      for (const other of callerRows) {
        if (other.id !== id) other.id.value = caller.id;
        if (other.role !== role) other.role.value = caller.role;
      }
      refreshAll();
    };
    id.addEventListener('input', sync);
    role.addEventListener('change', sync);
    callerRows.push({ id, role });
    const row = el('div', '', 'row caller');
    const both = el('span', '', 'caller-boxes');
    both.append(id, role);
    row.append(el('label', 'Calling as'), both);
    return row;
  };
  // curl to start, on every page; a choice holds for the page's operations.
  let snippetTab = 'curl';

  // ── The mock ─────────────────────────────────────────────────────────────
  let mock;
  let session;
  const start = async ({ seed, restore }) => {
    session = await startMock({ contracts, ...records, seed, restore });
    mock = session.mock;
    await refreshPickers();
    // The control panel shows this mock, and starts it over.
    hostMock({
      ...session,
      mock: () => mock,
      restart: ({ seed: again }) => start({ seed: again, restore: false }),
      // The control panel changed the mock: a record may have come or gone.
      changed: refreshPickers,
    });
  };

  const send = (method, path, { body, type = 'application/json', headers = {} } = {}) => mock.fetch(new Request(ORIGIN + path, {
    method,
    headers: { ...callerHeaders(), ...(body !== undefined ? { 'Content-Type': type } : {}), ...headers },
    body,
  }));

  /** The events the mock sent since a moment, oldest first. */
  const eventsSince = async (since) => {
    try {
      const response = await send('GET', `/platform/events?start=${encodeURIComponent(since)}&sort=time&limit=100`);
      if (!response.ok) return [];
      return (await response.json())?.items ?? [];
    } catch { return []; }
  };

  // ── Comboboxes ───────────────────────────────────────────────────────────
  // A parameter with choices — an enum's values, the records held under a
  // path — is a combobox (combobox.js). A record shows its status and
  // when it was created, fields every resource has, and typing matches those
  // too. Held records change only when something is sent, so every list is
  // read again after each send and when the mock starts, ready before it opens.
  const comboboxes = [];
  const refreshPickers = () => Promise.all(comboboxes.map((refresh) => refresh()));
  const createdText = (time) => {
    const date = new Date(time);
    if (Number.isNaN(date.getTime())) return '';
    const today = date.toDateString() === new Date().toDateString();
    return `created ${today ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : date.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  };
  const withPicker = (row, box, choicesOf) => {
    const { setChoices } = combobox(box, { none: 'none held' });
    comboboxes.push(async () => setChoices(await choicesOf()));
  };

  /**
   * The values a path parameter can take: the records the mock holds under
   * the path before it, newest first, each with its status and when it was created.
   */
  const heldUnder = async (prefix, name) => {
    try {
      const response = await send('GET', `${prefix}?limit=100`);
      if (!response.ok) return [];
      const items = (await response.json())?.items ?? [];
      return items.map((record) => ({
        value: record?.[name] ?? record?.id,
        detail: [record?.status, record?.createdAt ? createdText(record.createdAt) : ''].filter(Boolean).join('   '),
      })).filter((choice) => choice.value);
    } catch { return []; }
  };

  // ── Each operation ───────────────────────────────────────────────────────
  for (const holder of holders) {
    const op = operationFor(docs, holder.dataset.tryFile, holder.dataset.tryOp);
    const body = holder.querySelector('details > div');
    // The request, its code and its response go in the column beside the docs.
    const side = holder.querySelector('.op-side') ?? body;
    // Ahead of the documented responses, which Try it mode hides.
    const place = (node) => {
      const responses = side.querySelector(':scope > .responses-section');
      if (responses) responses.before(node); else side.append(node);
    };
    if (!op || !body) continue;
    // With Try it on, the Try it view, its docs folded under the description.
    holder.classList.add('trying');
    const fold = Object.assign(el('button', '▸ Docs', 'try-docs'), { type: 'button' });
    fold.setAttribute('aria-expanded', 'false');
    fold.onclick = () => {
      const open = holder.classList.toggle('docs-open');
      fold.textContent = open ? '▾ Docs' : '▸ Docs';
      fold.setAttribute('aria-expanded', String(open));
    };
    const description = holder.querySelector('.op-docs > .op-desc');
    if (description) description.after(fold); else holder.querySelector('.op-docs')?.prepend(fold);


    // The parameters whose values the client exports as a constant.
    const constants = new Map(); // "in:name" → { name, values }
    for (const declared of [...(op.item?.parameters ?? []), ...(op.operation.parameters ?? [])]) {
      const param = local(op.doc, declared);
      const constant = enumConstantOf(op.doc, param);
      if (constant) constants.set(`${param.in}:${param.name}`, constant);
    }

    // A box for each parameter, in the order the docs list them.
    const values = new Map(); // "in:name" → input
    const form = el('div', '', 'try-params');
    for (const param of holder.querySelectorAll('.param[data-param]')) {
      // Not refilled by the browser on a reload, which starts fresh.
      const box = Object.assign(el('input'), { type: 'text', autocomplete: 'off' });
      const label = el('label', param.dataset.param);
      label.append(el('span', param.dataset.in));
      // Its description, from the docs, on hovering over its name.
      const described = param.querySelector('.fdesc')?.textContent.trim();
      if (described) label.title = described;
      const row = el('div', '', 'row');
      row.append(label, box);
      const constant = constants.get(`${param.dataset.in}:${param.dataset.param}`);
      if (constant) {
        // One of the enum's values, offered as they are.
        withPicker(row, box, () => constant.values.map((value) => ({ value, detail: '' })));
        box.placeholder = param.hasAttribute('data-required') ? 'type or pick one' : 'optional';
      } else if (param.dataset.in === 'path') {
        // The records the mock holds there, newest first.
        const name = param.dataset.param;
        withPicker(row, box, () => heldUnder(prefixFor(name), name));
        box.placeholder = 'an id, or pick one';
      } else if (param.dataset.param.toLowerCase() === 'idempotency-key') {
        box.value = crypto.randomUUID();
      } else {
        box.placeholder = param.hasAttribute('data-required') ? 'required' : 'optional';
      }
      form.append(row);
      values.set(`${param.dataset.in}:${param.dataset.param}`, box);
    }
    form.prepend(el('h4', values.size ? 'Parameters' : 'Request', 'op-h'), callerRow());
    place(form);
    const searchExample = exampleSearch(op.doc, op, values.has('query:q'));
    const pathNames = [...op.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    const pathBox = (name) => values.get(`path:${name}`);
    function prefixFor(name) {
      return op.path.slice(0, op.path.indexOf(`/{${name}}`))
        .replace(/\{([^}]+)\}/g, (_, n) => encodeURIComponent(pathBox(n)?.value ?? ''));
    }

    // An editor above the request body's schema.
    let bodyBox = null;
    let fillFromRecord = async () => {};
    const section = holder.querySelector('.request-body-section');
    const bodies = startingBodies(docs, examples, op);
    if (section && bodies.length > 0) {
      const editor = el('div', '', 'try-body');
      // The body is edited where the code below shows it; this holds its text.
      bodyBox = el('textarea');
      bodyBox.hidden = true;
      if (bodies[0].fromRecord) {
        // The record the path names, refetched when the path changes, unless
        // the body has been edited since it was last filled.
        let filled = bodyBox.value = '{}';
        fillFromRecord = async () => {
          if (!mock || bodyBox.value !== filled) return;
          if (pathNames.some((name) => !pathBox(name)?.value.trim())) return;
          const path = op.path.replace(/\{([^}]+)\}/g, (_, n) => encodeURIComponent(pathBox(n).value.trim()));
          try {
            const response = await send('GET', path);
            if (!response.ok || bodyBox.value !== filled) return;
            filled = bodyBox.value = JSON.stringify(trimmed(await response.json(), bodies[0].fields), null, 2);
            refresh();
          } catch { /* left as it is */ }
        };
        for (const name of pathNames) pathBox(name)?.addEventListener('change', fillFromRecord);
      } else {
        bodyBox.value = JSON.stringify(bodies[0].value ?? {}, null, 2);
      }
      const row = el('div', '', 'pick');
      if (bodies.length > 1) {
        const pick = el('select');
        pick.append(...bodies.map((example, i) => Object.assign(el('option', example.name), { value: String(i) })));
        pick.onchange = () => { bodyBox.value = JSON.stringify(bodies[Number(pick.value)].value ?? {}, null, 2); };
        row.append(el('span', 'Example'), pick);
      }
      if (row.childElementCount) editor.append(row);
      editor.append(bodyBox);
      if (editor.childElementCount) place(editor);
    }

    // The request the form describes, read the same way for Send and the snippets.
    const requestFor = ({ placeholders = false } = {}) => {
      const path = {};
      const query = {};
      const headers = { ...callerHeaders() };
      for (const name of pathNames) {
        const value = pathBox(name)?.value.trim();
        path[name] = value || (placeholders ? `<${name}>` : '');
      }
      for (const [key, box] of values) {
        const where = key.slice(0, key.indexOf(':'));
        const name = key.slice(key.indexOf(':') + 1);
        if (!box.value.trim()) continue;
        if (where === 'query') query[name] = box.value.trim();
        if (where === 'header') headers[name] = box.value.trim();
      }
      return { template: op.path.slice(basePathOf(op.doc).length), path, query, headers, body: bodyBox ? bodyBox.value : undefined, type: mediaTypeOf(op) };
    };

    // The same request as code, before the responses: what Send would do,
    // written to run against the contract's server.
    const code = el('div', '', 'try-code');
    const tabs = el('div', '', 'tabs');
    const ruleset = rulesetOf(docs, op);
    const localCall = ruleset ? { namespace: ruleset.namespace, ruleset: ruleset.name } : undefined;
    // No generated client calls a document outside the contracts: curl only.
    const tabButtons = { curl: el('button', 'curl'), typescript: el('button', 'TypeScript') };
    if (localCall) tabButtons.local = el('button', 'TypeScript (local)');
    // The tab chosen on another operation, unless this one doesn't have it.
    const tabOf = () => (tabButtons[snippetTab] ? snippetTab : (tabButtons.typescript ? 'typescript' : 'curl'));
    const copy = el('button', 'Copy', 'copy');
    const pre = el('pre');
    const target = el('span', '', 'target');
    const button = el('button', 'Send', 'send');
    tabs.append(...Object.values(tabButtons), target, copy);
    code.append(tabs, pre);
    let written = {};
    // Tried, the body in the code is where it's edited: the text around it
    // follows the form, and the body itself is redrawn only when it isn't
    // being typed in.
    const MARK = '\u0000body\u0000';
    const bodyEdit = el('span', '', 'body-edit');
    bodyEdit.contentEditable = trying() ? 'plaintext-only' : 'false';
    bodyEdit.spellcheck = false;
    const indentOf = () => (tabOf() === 'typescript' ? '  ' : '');
    bodyEdit.addEventListener('input', (event) => {
      event.stopPropagation();
      const pad = indentOf();
      bodyBox.value = bodyEdit.textContent.split('\n').map((line, i) => (i && line.startsWith(pad) ? line.slice(pad.length) : line)).join('\n');
      try { JSON.parse(bodyBox.value); bodyEdit.classList.remove('invalid'); } catch { bodyEdit.classList.add('invalid'); }
      written = snippets({ doc: op.doc, method: op.method, operationId: op.operation.operationId, request: requestFor({ placeholders: true }), local: localCall, constants, exampleQuery: searchExample });
    });
    const refresh = () => {
      const request = requestFor({ placeholders: true });
      written = snippets({ doc: op.doc, method: op.method, operationId: op.operation.operationId, request, local: localCall, constants, exampleQuery: searchExample });
      const tab = tabOf();
      // The local call runs in the caller's code, not against a server.
      target.textContent = tab === 'local' ? 'runs in your code' : serverOf(op.doc);
      button.textContent = tab === 'local' ? 'Run' : 'Send';
      if (bodyBox) {
        const [before, after] = snippets({ doc: op.doc, method: op.method, operationId: op.operation.operationId, request, bodyMark: MARK, local: localCall, constants, exampleQuery: searchExample })[tab].split(MARK);
        if (document.activeElement !== bodyEdit) {
          bodyEdit.textContent = bodyBox.value.split('\n').map((line, i) => (i ? indentOf() + line : line)).join('\n');
        }
        if (bodyEdit.parentNode !== pre) pre.replaceChildren(document.createTextNode(before), bodyEdit, document.createTextNode(after));
        else { pre.firstChild.textContent = before; pre.lastChild.textContent = after; }
      } else {
        pre.textContent = written[tab];
      }
      for (const [name, tabButton] of Object.entries(tabButtons)) tabButton.classList.toggle('on', name === tab);
    };
    for (const [name, button] of Object.entries(tabButtons)) {
      button.onclick = () => {
        snippetTab = name;
        refreshAll();
      };
    }
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(written[tabOf()]); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select and copy'; }
      setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
    };
    holder.addEventListener('input', refresh);
    holder.addEventListener('change', refresh);
    refreshers.push(refresh);
    place(code);

    // Send, inside the code block, and what came back as the first of the
    // response tabs, beside the documented ones: one tab for what was sent,
    // and one for what a local run returned.
    const foot = el('div', '', 'foot');
    foot.append(button);
    code.append(foot);
    const showSent = (tabText, ok, content, key = 'sent') => {
      let section = holder.querySelector('.op-side > .responses-section');
      if (!section) {
        section = el('div', '', 'op-section responses-section');
        section.append(el('h4', 'Responses', 'op-h'), el('div', '', 'resp-tabs'));
        side.append(section);
      }
      const tabs = section.querySelector('.resp-tabs');
      let tab = tabs.querySelector(`.resp-tab[data-resp="${key}"]`);
      let panel = section.querySelector(`.resp-panel[data-resp="${key}"]`);
      if (!tab) {
        tab = Object.assign(el('button', '', 'resp-tab sent'), { type: 'button' });
        tab.dataset.resp = key;
        tabs.prepend(tab);
        panel = el('div', '', 'resp-panel');
        panel.dataset.resp = key;
        tabs.after(panel);
      }
      tab.textContent = tabText;
      tab.classList.toggle('resp-ok', ok);
      tab.classList.toggle('resp-bad', !ok);
      panel.replaceChildren(...content);
      for (const other of tabs.querySelectorAll('.resp-tab')) other.classList.toggle('on', other === tab);
      for (const other of section.querySelectorAll('.resp-panel')) other.hidden = other !== panel;
    };
    // A response, as Send shows it. What the call set off is in the control panel's activity log.
    const showResult = ({ status, statusText, ok, ms, headers, shown, streaming }) => {
      const headerList = el('div', '', 'sent-headers');
      for (const [name, value] of headers) headerList.append(el('div', `${name}: ${value}`));
      showSent(String(status), ok, [
        el('div', `${status}${statusText ? ` ${statusText}` : ''} · ${ms} ms`, `sent-status ${ok ? 'ok' : 'bad'}`),
        headerList,
        el('pre', streaming ? `${shown || '(nothing yet)'}\n\n(a stream: shown for its first ${STREAM_MS / 1000} seconds, then closed)` : (shown || '(no body)'), 'sent-body'),
      ]);
    };
    button.onclick = async () => {
      if (tabOf() === 'local') {
        // What the client's Rules.<ruleset>.evaluate returns: each output,
        // and every node it worked out on the way.
        try {
          const nodes = evaluate(ruleset.graph, JSON.parse(bodyBox?.value ?? '{}'));
          const result = Object.fromEntries((ruleset.graph.outputs ?? []).map((name) => [name, nodes[name]]));
          result.nodes = nodes;
          showSent('local', true, [
            el('div', 'Run in the page by the rules engine. Nothing was sent to the server.', 'sent-status ok'),
            el('pre', JSON.stringify(result, null, 2), 'sent-body'),
          ], 'local');
        } catch (error) {
          showSent('local · failed', false, [el('div', `Not run: ${error.message}`, 'sent-status bad')], 'local');
        }
        return;
      }
      if (!mock) return;
      button.disabled = true;
      try {
        const request = requestFor();
        const path = op.path.replace(/\{([^}]+)\}/g, (_, n) => encodeURIComponent(request.path[n] ?? ''));
        const query = new URLSearchParams(request.query);
        const started = performance.now();
        const sentAt = new Date().toISOString();
        const response = await send(op.method, query.size ? `${path}?${query}` : path, {
          body: request.body,
          type: request.type,
          headers: request.headers,
        });
        const ms = Math.round(performance.now() - started);
        // What the call set off: the events it caused, and what reacted to
        // them. A GET changes nothing, so it sets off nothing.
        const events = op.method !== 'GET' && response.ok ? await eventsSince(sentAt) : null;
        // A stream doesn't end, so show what arrives in its first seconds.
        const streaming = (response.headers.get('content-type') ?? '').includes('text/event-stream');
        const text = streaming ? await firstOf(response, STREAM_MS) : await response.text();
        let shown = text;
        let returned = null;
        try { returned = JSON.parse(text); shown = JSON.stringify(returned, null, 2); } catch { /* not JSON */ }
        // A call that publishes an event returns it, and it heads what followed,
        // though its time may be before the call was sent.
        const returnedEvent = events && returned?.specversion && returned.id ? returned.id : undefined;
        if (returnedEvent && !events.some((event) => event.id === returnedEvent)) events.unshift(returned);
        const result = {
          status: response.status, statusText: response.statusText, ok: response.ok, ms, headers: [...response.headers], shown, streaming, events,
          since: sentAt,
          returnedEvent,
        };
        showResult(result);
        logRequest(records, {
          time: sentAt, method: op.method, path: query.size ? `${path}?${query}` : path, body: request.body,
          status: response.status, ok: response.ok, ms, shown, eventIds: (events ?? []).map((event) => event.id),
        });
        // Kept for coming back to this page, with what was sent.
        if (holder.id) {
          results[holder.id] = { params: Object.fromEntries([...values].map(([k, box]) => [k, box.value])), body: bodyBox?.value, result };
          results.$last = holder.id;
          saveResults(records, results);
          // The address names the call last sent, so the browser's Back from
          // wherever its result leads comes back to it.
          history.replaceState(history.state, '', `${location.href.replace(/#.*$/, '')}#${holder.id}`);
        }
        // A request can register, remove or use up a stub; the next page keeps what's left.
        await session.keep();
        mockChanged();
        // What was sent may have made or removed a record a list offers.
        await refreshPickers();
        // A key used is spent: the next send gets a fresh one, unless typed over.
        const key = [...values].find(([k]) => k.toLowerCase() === 'header:idempotency-key')?.[1];
        if (key) key.value = crypto.randomUUID();
        refresh();
      } catch (error) {
        showSent('Error', false, [el('div', `Not sent: ${error.message}`, 'sent-status bad')]);
        logRequest(records, { time: new Date().toISOString(), method: op.method, path: op.path, status: null, ok: false, error: error.message });
        mockChanged();
      } finally {
        button.disabled = false;
      }
    };

    // Coming back to the page: as it was left, open, with what was sent and what came back.
    const kept = holder.id ? results[holder.id] : null;
    if (kept?.result) {
      for (const [k, value] of Object.entries(kept.params ?? {})) { const box = values.get(k); if (box) box.value = value; }
      if (bodyBox && typeof kept.body === 'string') bodyBox.value = kept.body;
      showResult(kept.result);
      const details = holder.querySelector('details');
      if (details) details.open = true;
      refresh();
    }
  }
  refreshAll();
  // Results put back open push what's below them down, so once they're in,
  // go again to where the address points, or else where the last request was sent.
  if (Object.keys(results).length) {
    const named = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    const back = named ?? (results.$last ? document.getElementById(results.$last) : null);
    if (back) requestAnimationFrame(() => back.scrollIntoView({ block: 'start' }));
  }

  await start({ seed: true, restore: true });
}

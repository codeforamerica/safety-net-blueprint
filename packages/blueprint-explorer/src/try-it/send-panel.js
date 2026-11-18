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
 * response tabs, beside the documented ones. Who is calling is one setting
 * for the page, shown and changed in any operation; the mock's status and
 * its Restart and Start empty end the header's line of sources.
 */

import { createMockServer } from '@codeforamerica/blueprint-mock-server/server';
import { extract } from '@codeforamerica/blueprint-core/browser';
import { restoreRecords, saveRecords } from './records.js';

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

/** The namespace the generated client exports a document's operations under: intake-openapi.yaml → intake. */
const namespaceOf = (doc) => (doc.relativePath ?? '').split('/').pop().replace(/-openapi\.yaml$/, '')
  .replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/** A value as TypeScript source: names unquoted where they can be, strings in single quotes. */
const tsValue = (value, indent = '') => {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    return value.length ? `[\n${value.map((v) => inner + tsValue(v, inner)).join(',\n')},\n${indent}]` : '[]';
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return '{}';
    const key = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k.replace(/'/g, "\\'")}'`);
    return `{\n${entries.map(([k, v]) => `${inner}${key(k)}: ${tsValue(v, inner)}`).join(',\n')},\n${indent}}`;
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
const snippets = ({ doc, method, operationId, request, bodyMark }) => {
  const { path, query, headers, body, type } = request;
  const parsed = (() => { try { return body === undefined ? undefined : JSON.parse(body); } catch { return undefined; } })();
  const args = [];
  if (Object.keys(path).length) args.push(`path: ${tsValue(path, '  ')}`);
  if (Object.keys(query).length) args.push(`query: ${tsValue(query, '  ')}`);
  if (Object.keys(headers).length) args.push(`headers: ${tsValue(headers, '  ')}`);
  if (body !== undefined) args.push(`body: ${bodyMark ?? (parsed === undefined ? body.trim() : tsValue(parsed, '  '))}`);
  const namespace = namespaceOf(doc);
  const typescript = `import { ${namespace} } from './generated'; // where you generated the client

const response = await ${namespace}.${operationId}(${args.length ? `{\n${args.map((a) => `  ${a},`).join('\n')}\n}` : ''});`;

  const filled = Object.entries(path).reduce((at, [name, value]) => at.replace(`{${name}}`, /^<.*>$/.test(value) ? value : encodeURIComponent(value)), request.template);
  const search = new URLSearchParams(query).toString();
  const lines = [`curl${method === 'GET' ? '' : ` -X ${method}`} ${shellQuote(serverOf(doc) + filled + (search ? `?${search}` : ''))}`];
  for (const [name, value] of Object.entries(headers)) lines.push(`  -H ${shellQuote(`${name}: ${value}`)}`);
  if (body !== undefined) {
    lines.push(`  -H ${shellQuote(`Content-Type: ${type}`)}`);
    lines.push(`  -d ${bodyMark ? `'${bodyMark}'` : shellQuote(parsed === undefined ? body : JSON.stringify(parsed, null, 2))}`);
  }
  return { typescript, curl: lines.join(' \\\n') };
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
  .try-params .row { display: grid; grid-template-columns: minmax(7rem, auto) 1fr; gap: 8px; align-items: center; padding: 3px 0; }
  .try-params label { font: 600 12px monospace; color: #333; }
  .try-params label span { font: 400 11px sans-serif; color: #888; margin-left: 4px; }
  .try-params input, .try-body textarea, .try-body select { font: 12px monospace; padding: 4px 6px; border: 1px solid #c7c4ea; border-radius: 4px; width: 100%; box-sizing: border-box; background: #fff; }
  .try-body textarea { min-height: 9rem; resize: vertical; }
  .try-body .pick { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; font-size: 11px; color: #555; }
  .try-body .pick select { width: auto; }
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
  #try-it-bar { display: inline-flex; align-items: center; gap: 10px; margin-left: auto; font-size: 11px; color: rgba(255,255,255,.75); }
  .try-params .caller-boxes { display: flex; gap: 6px; }
  .try-params .caller-boxes select { width: auto; }
  #try-it-bar button { font: 600 11px sans-serif; padding: 2px 8px; border-radius: 3px; border: 1px solid rgba(255,255,255,.4); background: transparent; color: #fff; cursor: pointer; }
  #try-it-bar .ready { color: #8ff0c0; }
`;

/**
 * @param {{ contracts: object, version: string, scope: string }} options
 */
export async function mountSendPanels({ contracts, version, scope }) {
  const holders = [...document.querySelectorAll('[data-try-op]')];
  const bar = document.getElementById('try-it-bar');
  if (!holders.length || !bar) return;
  document.head.append(Object.assign(el('style'), { textContent: STYLE }));

  const docs = extract(contracts, 'docs');
  const examples = { records: extract(docs, 'examples'), config: {} };
  for (const { catalogs } of extract(docs, 'config')) {
    for (const { resourceName, entries } of Object.values(catalogs ?? {})) {
      (examples.config[resourceName] ??= []).push(...(entries ?? []));
    }
  }
  const records = { scope, version };
  const roles = docs.find((d) => Array.isArray(d.content?.$defs?.RoleType?.enum))?.content.$defs.RoleType.enum ?? [];
  const caller = { id: 'the-explorer', role: '' };
  const callerHeaders = () => ({
    ...(caller.id.trim() ? { 'X-Caller-Id': caller.id.trim() } : {}),
    ...(caller.role ? { 'X-Caller-Roles': caller.role } : {}),
  });

  // ── The bar ──────────────────────────────────────────────────────────────
  const status = el('span', 'starting the mock…');
  const restart = el('button', 'Restart with data');
  const empty = el('button', 'Start empty');
  bar.append(status, restart, empty);
  // The mock's controls end the line above, beside the page's sources.
  const meta = bar.previousElementSibling;
  if (meta) meta.append(bar);

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
  const start = async ({ seed, restore }) => {
    status.textContent = 'starting the mock…';
    status.classList.remove('ready');
    const started = performance.now();
    mock = await createMockServer({ contracts, seed });
    if (restore) restoreRecords(mock, records);
    status.textContent = `mock ready · ${Math.round(performance.now() - started)} ms`;
    status.classList.add('ready');
  };
  restart.onclick = () => start({ seed: true, restore: false });
  empty.onclick = () => start({ seed: false, restore: false });
  addEventListener('pagehide', () => { if (mock) saveRecords(mock, records); });

  const send = (method, path, { body, type = 'application/json', headers = {} } = {}) => mock.fetch(new Request(ORIGIN + path, {
    method,
    headers: { ...callerHeaders(), ...(body !== undefined ? { 'Content-Type': type } : {}), ...headers },
    body,
  }));

  /** The values a path parameter can take: the records the mock holds under the path before it. */
  const heldUnder = async (prefix, name) => {
    try {
      const response = await send('GET', `${prefix}?limit=100`);
      if (!response.ok) return [];
      const items = (await response.json())?.items ?? [];
      return items.map((record) => record?.[name] ?? record?.id).filter(Boolean);
    } catch { return []; }
  };

  // ── Each operation ───────────────────────────────────────────────────────
  const opened = []; // operations already open when the mock is ready
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


    // A box for each parameter, in the order the docs list them.
    const values = new Map(); // "in:name" → input
    const form = el('div', '', 'try-params');
    for (const param of holder.querySelectorAll('.param[data-param]')) {
      // Not refilled by the browser on a reload, which starts fresh.
      const box = Object.assign(el('input'), { type: 'text', autocomplete: 'off' });
      const label = el('label', param.dataset.param);
      label.append(el('span', param.dataset.in));
      const row = el('div', '', 'row');
      row.append(label, box);
      if (param.dataset.in === 'path') {
        const list = el('datalist');
        list.id = `held-${op.operation.operationId}-${param.dataset.param}`;
        box.setAttribute('list', list.id);
        box.placeholder = 'an id, or pick one';
        row.append(list);
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
    const pathNames = [...op.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    const pathBox = (name) => values.get(`path:${name}`);
    const prefixFor = (name) => op.path.slice(0, op.path.indexOf(`/{${name}}`))
      .replace(/\{([^}]+)\}/g, (_, n) => encodeURIComponent(pathBox(n)?.value ?? ''));
    for (const name of pathNames) {
      const box = pathBox(name);
      if (!box) continue;
      box.onfocus = async () => {
        const list = document.getElementById(box.getAttribute('list'));
        list?.replaceChildren(...(await heldUnder(prefixFor(name), name)).map((value) => Object.assign(el('option'), { value })));
      };
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
    const tabButtons = { curl: el('button', 'curl'), typescript: el('button', 'TypeScript') };
    const copy = el('button', 'Copy', 'copy');
    const pre = el('pre');
    tabs.append(tabButtons.curl, tabButtons.typescript, el('span', serverOf(op.doc), 'target'), copy);
    code.append(tabs, pre);
    let written = {};
    // Tried, the body in the code is where it's edited: the text around it
    // follows the form, and the body itself is redrawn only when it isn't
    // being typed in.
    const MARK = '\u0000body\u0000';
    const bodyEdit = el('span', '', 'body-edit');
    bodyEdit.contentEditable = 'plaintext-only';
    bodyEdit.spellcheck = false;
    const indentOf = () => (snippetTab === 'typescript' ? '  ' : '');
    bodyEdit.addEventListener('input', (event) => {
      event.stopPropagation();
      const pad = indentOf();
      bodyBox.value = bodyEdit.textContent.split('\n').map((line, i) => (i && line.startsWith(pad) ? line.slice(pad.length) : line)).join('\n');
      try { JSON.parse(bodyBox.value); bodyEdit.classList.remove('invalid'); } catch { bodyEdit.classList.add('invalid'); }
      written = snippets({ doc: op.doc, method: op.method, operationId: op.operation.operationId, request: requestFor({ placeholders: true }) });
    });
    const refresh = () => {
      const request = requestFor({ placeholders: true });
      written = snippets({ doc: op.doc, method: op.method, operationId: op.operation.operationId, request });
      if (bodyBox) {
        const [before, after] = snippets({ doc: op.doc, method: op.method, operationId: op.operation.operationId, request, bodyMark: MARK })[snippetTab].split(MARK);
        if (document.activeElement !== bodyEdit) {
          bodyEdit.textContent = bodyBox.value.split('\n').map((line, i) => (i ? indentOf() + line : line)).join('\n');
        }
        if (bodyEdit.parentNode !== pre) pre.replaceChildren(document.createTextNode(before), bodyEdit, document.createTextNode(after));
        else { pre.firstChild.textContent = before; pre.lastChild.textContent = after; }
      } else {
        pre.textContent = written[snippetTab];
      }
      for (const [name, button] of Object.entries(tabButtons)) button.classList.toggle('on', name === snippetTab);
    };
    for (const [name, button] of Object.entries(tabButtons)) {
      button.onclick = () => {
        snippetTab = name;
        refreshAll();
      };
    }
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(written[snippetTab]); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select and copy'; }
      setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
    };
    holder.addEventListener('input', refresh);
    holder.addEventListener('change', refresh);
    refreshers.push(refresh);
    place(code);

    // Send, inside the code block, and what came back as the first of the
    // response tabs, beside the documented ones.
    const foot = el('div', '', 'foot');
    const button = el('button', 'Send', 'send');
    foot.append(button);
    code.append(foot);
    const showSent = (tabText, ok, content) => {
      let section = holder.querySelector('.op-side > .responses-section');
      if (!section) {
        section = el('div', '', 'op-section responses-section');
        section.append(el('h4', 'Responses', 'op-h'), el('div', '', 'resp-tabs'));
        side.append(section);
      }
      const tabs = section.querySelector('.resp-tabs');
      let tab = tabs.querySelector('.resp-tab.sent');
      let panel = section.querySelector('.resp-panel[data-resp="sent"]');
      if (!tab) {
        tab = Object.assign(el('button', '', 'resp-tab sent'), { type: 'button' });
        tab.dataset.resp = 'sent';
        tabs.prepend(tab);
        panel = el('div', '', 'resp-panel');
        panel.dataset.resp = 'sent';
        tabs.after(panel);
      }
      tab.textContent = tabText;
      tab.classList.toggle('resp-ok', ok);
      tab.classList.toggle('resp-bad', !ok);
      panel.replaceChildren(...content);
      for (const other of tabs.querySelectorAll('.resp-tab')) other.classList.toggle('on', other === tab);
      for (const other of section.querySelectorAll('.resp-panel')) other.hidden = other !== panel;
    };
    button.onclick = async () => {
      if (!mock) return;
      button.disabled = true;
      try {
        const request = requestFor();
        const path = op.path.replace(/\{([^}]+)\}/g, (_, n) => encodeURIComponent(request.path[n] ?? ''));
        const query = new URLSearchParams(request.query);
        const started = performance.now();
        const response = await send(op.method, query.size ? `${path}?${query}` : path, {
          body: request.body,
          type: request.type,
          headers: request.headers,
        });
        const ms = Math.round(performance.now() - started);
        // A stream doesn't end, so show what arrives in its first seconds.
        const streaming = (response.headers.get('content-type') ?? '').includes('text/event-stream');
        const text = streaming ? await firstOf(response, STREAM_MS) : await response.text();
        let shown = text;
        try { shown = JSON.stringify(JSON.parse(text), null, 2); } catch { /* not JSON */ }
        const headerList = el('div', '', 'sent-headers');
        for (const [name, value] of response.headers) headerList.append(el('div', `${name}: ${value}`));
        showSent(`${response.status} · sent`, response.ok, [
          el('div', `${response.status}${response.statusText ? ` ${response.statusText}` : ''} · ${ms} ms`, `sent-status ${response.ok ? 'ok' : 'bad'}`),
          headerList,
          el('pre', streaming ? `${shown || '(nothing yet)'}\n\n(a stream: shown for its first ${STREAM_MS / 1000} seconds, then closed)` : (shown || '(no body)'), 'sent-body'),
        ]);
        // A key used is spent: the next send gets a fresh one, unless typed over.
        const key = [...values].find(([k]) => k.toLowerCase() === 'header:idempotency-key')?.[1];
        if (key) key.value = crypto.randomUUID();
        refresh();
      } catch (error) {
        showSent('not sent', false, [el('div', `Not sent: ${error.message}`, 'sent-status bad')]);
      } finally {
        button.disabled = false;
      }
    };

    // Its empty path parameters start on records the mock holds, each
    // under the one before: an application that has incomes, then one of
    // its incomes.
    const fill = async (at) => {
      if (at === pathNames.length) return true;
      const box = pathBox(pathNames[at]);
      if (!box) return fill(at + 1);
      if (box.value) return fill(at + 1);
      for (const value of await heldUnder(prefixFor(pathNames[at]), pathNames[at])) {
        box.value = value;
        if (await fill(at + 1)) return true;
      }
      box.value = '';
      return false;
    };
    const prefill = async () => {
      if (!mock) return;
      await fill(0);
      // Nothing held all the way down: take what there is at each level.
      for (const name of pathNames) {
        const box = pathBox(name);
        if (box && !box.value) box.value = (await heldUnder(prefixFor(name), name))[0] ?? '';
      }
      await fillFromRecord();
      refresh();
    };
    // Opened, an operation is ready to send.
    const details = holder.querySelector('details');
    details?.addEventListener('toggle', () => { if (details.open) prefill(); });
    opened.push(() => { if (details?.open) prefill(); });
  }
  refreshAll();

  await start({ seed: true, restore: true });
  for (const prefillOpen of opened) prefillOpen();
}

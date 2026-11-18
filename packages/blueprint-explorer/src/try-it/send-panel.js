/**
 * Try it mode, on an API reference page: the reference itself becomes the
 * request form, sent to the mock running in the page.
 *
 * The page renders as plain reference first. Its `mock/mock.js` and
 * `mock/contracts.js` load deferred, then this adds a Docs | Try it switch
 * to the bar under the page header and boots the mock in the background,
 * restoring the records earlier pages left (records.js).
 *
 * In Try it mode, each operation's parameters table gains a Value column —
 * path, query and header parameters alike, path ids suggesting the records
 * the mock holds — its request body section gains an editor pre-filled from
 * the contracts, and Send and the response follow its responses. The headers
 * that say who is calling are set once, in the bar, and shown above Send.
 * Docs mode is the page as it was. The mode is remembered between pages.
 */

import { createMockServer } from '@codeforamerica/blueprint-mock-server/server';
import { extract } from '@codeforamerica/blueprint-core/browser';
import { restoreRecords, saveRecords } from './records.js';

const ORIGIN = 'http://mock.invalid';
const MANAGED = new Set(['id', 'createdAt', 'updatedAt', 'status', '_links']);
const MODE_KEY = 'blueprint-explorer-mode';

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
 * The fields a request schema accepts, through `allOf` and same-document
 * `$ref`s, leaving out read-only ones. A reference to another document is
 * passed over; null when no field is named.
 */
const fieldsOf = (doc, schema, seen = new Set()) => {
  const node = local(doc, schema);
  if (!node || typeof node !== 'object' || seen.has(node)) return null;
  seen.add(node);
  const names = new Set(Object.entries(node.properties ?? {})
    .filter(([, property]) => !local(doc, property)?.readOnly).map(([name]) => name));
  for (const part of node.allOf ?? []) for (const name of fieldsOf(doc, part, seen) ?? []) names.add(name);
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
  body:not(.try-mode) .try-only { display: none !important; }
  /* Trying, the reference keeps what a request needs: each parameter's name,
     type and description, not where it goes or whether it's required (the
     box says), and not the responses, which Send shows for real. */
  body.try-mode .responses-section { display: none; }
  body.try-mode table.params-table tr > :nth-child(3), body.try-mode table.params-table tr > :nth-child(4) { display: none; }
  body.try-mode table.params-table tr > td[colspan] { display: table-cell; }
  .try-value { padding: 4px 12px; min-width: 14rem; }
  .try-value input, .try-body textarea, .try-body select { font: 12px monospace; padding: 4px 6px; border: 1px solid #c7c4ea; border-radius: 4px; width: 100%; box-sizing: border-box; background: #fff; }
  .try-body { padding: 8px 12px; border: 1px solid #eee; border-bottom: none; background: #f6f5fd; }
  .try-body textarea { min-height: 9rem; resize: vertical; }
  .try-body .pick { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; font-size: 11px; color: #555; }
  .try-body .pick select { width: auto; }
  .try-send { margin-top: 16px; padding: 10px 12px; border: 1px solid #c7c4ea; border-radius: 4px; background: #f6f5fd; font-size: 12px; }
  .try-send .sent-as { font-family: monospace; font-size: 11px; color: #555; margin-bottom: 8px; }
  .try-send button { font: 600 12px sans-serif; padding: 5px 16px; border-radius: 4px; border: 1px solid #2B1A78; background: #2B1A78; color: #fff; cursor: pointer; }
  .try-send button:disabled { opacity: .5; cursor: default; }
  .try-send .status { font-weight: 700; margin-top: 10px; }
  .try-send .status.ok { color: #15803d; } .try-send .status.bad { color: #b42318; }
  .try-send .headers { margin: 6px 0 0; font: 11px monospace; color: #555; }
  .try-send .headers div { white-space: pre-wrap; word-break: break-all; }
  .try-send pre { margin: 6px 0 0; padding: 8px 10px; background: #fff; border: 1px solid #eee; border-radius: 4px; max-height: 22rem; overflow: auto; white-space: pre-wrap; font-size: 11px; }
  #try-it-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 6px 1.25rem 8px; font-size: 11px; color: rgba(255,255,255,.75); }
  #try-it-bar input, #try-it-bar select { font: 11px sans-serif; padding: 2px 5px; border-radius: 3px; border: 0; }
  #try-it-bar button { font: 600 11px sans-serif; padding: 2px 8px; border-radius: 3px; border: 1px solid rgba(255,255,255,.4); background: transparent; color: #fff; cursor: pointer; }
  #try-it-bar .switch { display: inline-flex; border: 1px solid rgba(255,255,255,.4); border-radius: 3px; overflow: hidden; }
  #try-it-bar .switch button { border: 0; border-radius: 0; }
  #try-it-bar .switch button.on { background: #fff; color: #2B1A78; }
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
  const docsButton = el('button', 'Docs');
  const tryButton = el('button', 'Try it');
  const toggle = el('span', '', 'switch');
  toggle.append(docsButton, tryButton);
  const status = el('span', 'starting the mock…', 'try-only');
  const id = Object.assign(el('input'), { value: caller.id, size: 14 });
  id.setAttribute('aria-label', 'Caller id');
  const role = el('select');
  role.append(Object.assign(el('option', 'no role'), { value: '' }), ...roles.map((r) => Object.assign(el('option', r), { value: r })));
  const callingAs = el('span', '', 'try-only');
  callingAs.style.display = 'inline-flex';
  callingAs.style.gap = '6px';
  callingAs.style.alignItems = 'center';
  callingAs.append(el('span', 'Calling as'), id, role);
  const restart = el('button', 'Restart with data', 'try-only');
  const empty = el('button', 'Start empty', 'try-only');
  bar.append(toggle, callingAs, status, restart, empty);

  const sentAsLines = [];
  const showSentAs = () => {
    const text = Object.entries(callerHeaders()).map(([name, value]) => `${name}: ${value}`).join(' · ') || 'no caller headers (unauthenticated)';
    for (const line of sentAsLines) line.textContent = `Sent as  ${text}`;
  };
  id.oninput = () => { caller.id = id.value; showSentAs(); };
  role.onchange = () => { caller.role = role.value; showSentAs(); };

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
  const prefills = [];
  for (const holder of holders) {
    const op = operationFor(docs, holder.dataset.tryFile, holder.dataset.tryOp);
    const body = holder.querySelector('details > div');
    if (!op || !body) continue;

    // A Value column in the parameters table.
    const values = new Map(); // "in:name" → input
    const table = holder.querySelector('table.params-table');
    if (table) {
      const head = table.querySelector('thead tr');
      const th = el('th', 'Value', 'try-only');
      th.style.cssText = head.firstElementChild.style.cssText;
      head.append(th);
      for (const row of table.querySelectorAll('tbody tr')) {
        if (!row.dataset.param) {
          const cell = row.querySelector('td[colspan]');
          if (cell) cell.colSpan += 1;
          continue;
        }
        const box = Object.assign(el('input'), { type: 'text' });
        const td = el('td', '', 'try-value try-only');
        td.append(box);
        if (row.dataset.in === 'path') {
          const list = el('datalist');
          list.id = `held-${op.operation.operationId}-${row.dataset.param}`;
          box.setAttribute('list', list.id);
          box.placeholder = 'an id, or pick one';
          td.append(list);
        } else if (row.dataset.param.toLowerCase() === 'idempotency-key') {
          box.value = crypto.randomUUID();
        } else {
          box.placeholder = row.querySelector('td:nth-child(4)')?.textContent.trim() ? 'required' : 'optional';
        }
        row.append(td);
        values.set(`${row.dataset.in}:${row.dataset.param}`, box);
      }
    }
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
      const editor = el('div', '', 'try-body try-only');
      bodyBox = el('textarea');
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
          } catch { /* left as it is */ }
        };
        for (const name of pathNames) pathBox(name)?.addEventListener('change', fillFromRecord);
      } else {
        bodyBox.value = JSON.stringify(bodies[0].value ?? {}, null, 2);
      }
      if (bodies.length > 1) {
        const pick = el('select');
        pick.append(...bodies.map((example, i) => Object.assign(el('option', example.name), { value: String(i) })));
        pick.onchange = () => { bodyBox.value = JSON.stringify(bodies[Number(pick.value)].value ?? {}, null, 2); };
        const row = el('div', '', 'pick');
        row.append(el('span', 'Example'), pick);
        editor.append(row);
      }
      editor.append(bodyBox);
      section.firstElementChild.after(editor);
    }

    // Send, after the responses.
    const panel = el('div', '', 'try-send try-only');
    const sentAs = el('div', '', 'sent-as');
    sentAsLines.push(sentAs);
    const button = el('button', `Send ${op.method}`);
    const answer = el('div');
    button.onclick = async () => {
      if (!mock) return;
      button.disabled = true;
      try {
        const path = op.path.replace(/\{([^}]+)\}/g, (_, n) => encodeURIComponent(pathBox(n)?.value.trim() ?? ''));
        const query = new URLSearchParams();
        const headers = {};
        for (const [key, box] of values) {
          const where = key.slice(0, key.indexOf(':'));
          const name = key.slice(key.indexOf(':') + 1);
          if (!box.value.trim()) continue;
          if (where === 'query') query.append(name, box.value.trim());
          if (where === 'header') headers[name] = box.value.trim();
        }
        const started = performance.now();
        const response = await send(op.method, query.size ? `${path}?${query}` : path, {
          body: bodyBox ? bodyBox.value : undefined,
          type: mediaTypeOf(op),
          headers,
        });
        const ms = Math.round(performance.now() - started);
        const text = await response.text();
        let shown = text;
        try { shown = JSON.stringify(JSON.parse(text), null, 2); } catch { /* not JSON */ }
        const headerList = el('div', '', 'headers');
        for (const [name, value] of response.headers) headerList.append(el('div', `${name}: ${value}`));
        answer.replaceChildren(
          el('div', `${response.status}${response.statusText ? ` ${response.statusText}` : ''} · ${ms} ms`, `status ${response.ok ? 'ok' : 'bad'}`),
          headerList,
          el('pre', shown || '(no body)'),
        );
        // A key used is spent: the next send gets a fresh one, unless typed over.
        const key = [...values].find(([k]) => k.toLowerCase() === 'header:idempotency-key')?.[1];
        if (key) key.value = crypto.randomUUID();
      } catch (error) {
        answer.replaceChildren(el('div', `Not sent: ${error.message}`, 'status bad'));
      } finally {
        button.disabled = false;
      }
    };
    panel.append(sentAs, button, answer);
    body.append(panel);

    // Opened in Try it mode, its path parameters start on records the mock
    // holds, each filled from the one before.
    const details = holder.querySelector('details');
    const prefill = async () => {
      if (!details?.open || !mock || !document.body.classList.contains('try-mode')) return;
      for (const name of pathNames) {
        const box = pathBox(name);
        if (box && !box.value) box.value = (await heldUnder(prefixFor(name), name))[0] ?? '';
      }
      await fillFromRecord();
    };
    details?.addEventListener('toggle', prefill);
    prefills.push(prefill);
  }
  showSentAs();

  // ── The mode ─────────────────────────────────────────────────────────────
  const setMode = (mode) => {
    document.body.classList.toggle('try-mode', mode === 'try');
    docsButton.classList.toggle('on', mode !== 'try');
    tryButton.classList.toggle('on', mode === 'try');
    try { sessionStorage.setItem(MODE_KEY, mode); } catch { /* not kept */ }
    if (mode === 'try') for (const prefill of prefills) prefill();
  };
  docsButton.onclick = () => setMode('docs');
  tryButton.onclick = () => setMode('try');
  let saved = 'docs';
  try { saved = sessionStorage.getItem(MODE_KEY) ?? 'docs'; } catch { /* not kept */ }
  setMode(saved);

  await start({ seed: true, restore: true });
  if (saved === 'try') for (const prefill of prefills) prefill();
}

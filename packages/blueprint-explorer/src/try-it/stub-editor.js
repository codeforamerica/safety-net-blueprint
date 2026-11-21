/**
 * Writing a stub in the control panel, with the contracts' choices offered
 * rather than typed. Each kind is the mock's own
 * (blueprint-mock-server/schemas/stubs-schema.json):
 *
 *   - an event stub answers an event by publishing another. Which event to
 *     answer, the fields it can be matched on and the event to publish back
 *     are picked; the data starts from that event's example. A timer request
 *     is answered with the callback it carries, so only which timers to fire
 *     is picked.
 *   - an HTTP stub answers a request the mock would otherwise handle, such as
 *     a call to an adapter: which operation, its path's values, and the
 *     status and body to answer with, started from the documented example.
 *   - a WebSocket stub answers a message on a connection, such as the
 *     relay's: the channel, the message, and what to send back, each started
 *     from the message's schema, with an optional delay and a close.
 *
 * Every form shows the stub as JSON, and edits it as written for anything the
 * form doesn't cover.
 */

import { combobox } from './combobox.js';

const TIMER_REQUESTED = 'platform.timer.requested';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const el = (tag, text = '', className = '') => {
  const node = document.createElement(tag);
  if (text !== '') node.textContent = text;
  if (className) node.className = className;
  return node;
};

export const STUB_STYLE = `
  #mock-panel .se { border: 1px solid #c7c4ea; border-radius: 6px; padding: .7rem .8rem; margin: .4rem 0 .6rem; background: #fbfaff; font-size: .85rem; }
  #mock-panel .se label { display: block; font-weight: 600; margin: .5rem 0 .2rem; }
  #mock-panel .se label:first-child { margin-top: 0; }
  #mock-panel .se select, #mock-panel .se input, #mock-panel .se textarea { width: 100%; box-sizing: border-box; font: 12px ui-monospace, Menlo, monospace; padding: .3rem .4rem; border: 1px solid #ccc; border-radius: 4px; background: #fff; }
  #mock-panel .se textarea { min-height: 7rem; resize: vertical; }
  #mock-panel .se .se-row { display: flex; gap: .4rem; margin-bottom: .3rem; align-items: center; }
  #mock-panel .se .se-row select, #mock-panel .se .se-row input { flex: 1; width: auto; min-width: 0; }
  #mock-panel .se .se-row .se-name { flex: none; font: 12px ui-monospace, Menlo, monospace; color: #555; }
  #mock-panel .se .se-row input.se-ms { flex: none; width: 6rem; }
  #mock-panel .se .se-message { border-left: 3px solid #c7c4ea; padding-left: .5rem; margin: .3rem 0 .6rem; }
  #mock-panel .se .se-message textarea { min-height: 4rem; }
  #mock-panel .se .se-hint { color: #666; font-size: .8rem; margin: .2rem 0 0; }
  #mock-panel .se .se-link { background: none; border: 0; padding: 0; color: #2B1A78; font: 600 12px system-ui, sans-serif; cursor: pointer; }
  #mock-panel .se .se-x { background: none; border: 0; color: #b42318; font-size: 16px; cursor: pointer; padding: 0 .2rem; }
  #mock-panel .se pre { margin: .3rem 0 0; padding: .4rem .5rem; background: #fff; border: 1px solid #eee; border-radius: 4px; font-size: 11px; white-space: pre-wrap; }
  #mock-panel .se .se-error { color: #b42318; margin: .4rem 0 0; white-space: pre-wrap; }
  #mock-panel .se .se-actions { display: flex; gap: .5rem; margin-top: .7rem; }
  #mock-panel .se .combo-list { width: 100%; box-sizing: border-box; }
`;

// ── Shared ────────────────────────────────────────────────────────────────────

/** Every dot path to a value in an example, such as `data.status`. */
const pathsIn = (value, prefix = '') => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return prefix ? [[prefix, value]] : [];
  return Object.entries(value).flatMap(([key, inner]) => pathsIn(inner, prefix ? `${prefix}.${key}` : key));
};

/** A typed value as JSON reads it, so `true` and `3` match as written; else the text. */
const typed = (value) => {
  try { return JSON.parse(value); } catch { return value; }
};

const withoutId = ({ id, ...stub }) => stub; // eslint-disable-line no-unused-vars

const pretty = (value) => (value === undefined ? '' : JSON.stringify(value, null, 2));

const select = (value, options, placeholder) => {
  const picker = el('select');
  if (placeholder !== null) picker.append(Object.assign(el('option', placeholder), { value: '' }));
  for (const option of options) {
    const [optionValue, label] = Array.isArray(option) ? option : [option, option];
    picker.append(Object.assign(el('option', label), { value: optionValue }));
  }
  picker.value = value;
  return picker;
};

/**
 * A box to pick an event type in, narrowed to the names with what's typed in
 * them, each shown with its summary. Only a type there is is picked; anything
 * else goes back to what was.
 */
const eventPicker = (box, value, events, pick) => {
  const input = Object.assign(el('input'), { value, placeholder: 'Type to find an event…', spellcheck: false });
  box.append(input);
  combobox(input, { choices: [...events.keys()].sort().map((type) => ({ value: type, detail: events.get(type).summary })), matchDetail: false });
  // Typing replaces the event picked, rather than adding to its name: selected
  // once the click has placed its caret.
  const selectAll = () => setTimeout(() => input.select());
  input.addEventListener('focus', selectAll);
  input.addEventListener('click', selectAll);
  input.onchange = () => {
    if (input.value === value) return;
    if (events.has(input.value) || input.value === '') pick(input.value);
    else input.value = value;
  };
  return input;
};

/** A `#/…` reference within a document, followed. */
const local = (node, content) => {
  let seen = 0;
  let at = node;
  while (typeof at?.$ref === 'string' && at.$ref.startsWith('#/') && seen++ < 10) {
    at = at.$ref.slice(2).split('/').reduce((inner, part) => inner?.[part.replace(/~1/g, '/').replace(/~0/g, '~')], content);
  }
  return at;
};

/**
 * Conditions on a stub's match: a field picked, or typed, and the value it
 * must equal, with suggestions for each field.
 */
function conditionRows(box, state, { paths, suggestions = () => [], redraw, preview }) {
  const listId = (name) => `se-${name.replace(/[^\w-]/g, '-')}`;
  for (const [index, [path, value]] of state.match.entries()) {
    const row = el('div', '', 'se-row');
    const field = select(path, paths.includes(path) || !path ? paths : [...paths, path], 'Pick a field…');
    field.onchange = () => { state.match[index] = [field.value, '']; redraw(); };
    const given = Object.assign(el('input'), { value: value ?? '', placeholder: 'equals…' });
    given.setAttribute('list', listId(path));
    const list = el('datalist');
    list.id = listId(path);
    for (const suggestion of path ? suggestions(path) : []) list.append(Object.assign(el('option'), { value: suggestion }));
    given.oninput = () => { state.match[index][1] = given.value; preview(); };
    const remove = Object.assign(el('button', '×', 'se-x'), { type: 'button', title: 'Remove this condition' });
    remove.onclick = () => { state.match.splice(index, 1); redraw(); };
    row.append(field, given, list, remove);
    box.append(row);
  }
  const add = Object.assign(el('button', '+ Add a condition', 'se-link'), { type: 'button' });
  add.onclick = () => { state.match.push(['', '']); redraw(); };
  box.append(add);
}

const matchOf = (state) => Object.fromEntries(state.match.filter(([path]) => path.trim()).map(([path, value]) => [path.trim(), typed(value)]));

/**
 * What every form shares: the fields, the stub as JSON beneath them, editing
 * it as JSON instead, and Register or Save with Cancel, showing what the mock
 * said if it refused.
 *
 * @param {{ stub: object|null, opensAsJson: boolean, fields: (box: HTMLElement, redraw: () => void, preview: () => void) => void,
 *   built: () => object, ready: () => boolean, save: (stub: object) => Promise<string|null>, cancel: () => void }} form
 */
function formShell({ stub, opensAsJson, fields, built, ready, save, cancel }) {
  const box = el('div', '', 'se');
  let asJson = opensAsJson;
  let json = stub ? pretty(withoutId(stub)) : '';

  const actions = (read) => {
    const wrap = el('div');
    const error = el('p', '', 'se-error');
    const row = el('div', '', 'se-actions');
    const go = Object.assign(el('button', stub ? 'Save' : 'Register', 'mp-action'), { type: 'button', disabled: !read });
    go.onclick = async () => {
      const value = read();
      if (value?.error) { error.textContent = value.error; return; }
      go.disabled = true;
      const refused = await save(value);
      if (refused) { error.textContent = refused; go.disabled = false; }
    };
    const stop = Object.assign(el('button', 'Cancel', 'mp-action'), { type: 'button' });
    stop.onclick = cancel;
    row.append(go, stop);
    wrap.append(row, error);
    return wrap;
  };

  const preview = () => {
    const pre = box.querySelector('.se-json');
    if (pre) pre.textContent = pretty(built());
  };

  const draw = () => {
    box.replaceChildren();
    if (asJson) {
      box.append(el('label', 'The stub, as JSON'));
      const area = el('textarea');
      area.value = json || pretty(built());
      area.oninput = () => { json = area.value; };
      box.append(area, actions(() => {
        try { return JSON.parse(area.value); } catch (error) { return { error: `Not JSON: ${error.message}` }; }
      }));
      const back = Object.assign(el('button', 'Back to the form', 'se-link'), { type: 'button' });
      back.onclick = () => { asJson = false; draw(); };
      box.append(back);
      return;
    }
    fields(box, draw, preview);
    const shown = el('details');
    shown.append(el('summary', 'JSON'), el('pre', '', 'se-json'));
    const edit = Object.assign(el('button', 'Edit as JSON', 'se-link'), { type: 'button' });
    edit.onclick = () => { json = pretty(built()); asJson = true; draw(); };
    shown.append(edit);
    box.append(shown, actions(ready() ? built : null));
    preview();
  };

  draw();
  return box;
}

// ── Event stubs ───────────────────────────────────────────────────────────────

// The envelope's own attributes, the same on every event or never repeated: not worth matching on.
const ENVELOPE = new Set(['specversion', 'id', 'type', 'time', 'datacontenttype', 'traceparent', 'partitionkey', 'authid', 'authtype', 'causationid']);

/** Whether an AsyncAPI document describes a WebSocket connection rather than events. */
const overWebSocket = (content) => Object.values(content?.servers ?? {}).some((server) => /^wss?$/.test(server?.protocol ?? ''))
  || Object.values(content?.channels ?? {}).some((channel) => channel?.bindings?.ws);

/**
 * What the contracts offer the three kinds of stub.
 *
 * @param {object[]} docs - From `extract(contracts, 'docs')`
 * @param {Record<string, { data: object }[]>} records - The sample records by
 *   schema, from `extract(docs, 'examples')`, for an answer the contracts give
 *   no example of
 */
export function stubChoices(docs, records = {}) {
  // Each event type, with its example.
  const events = new Map();
  for (const doc of docs.filter((d) => d.type === 'asyncapi' && !overWebSocket(d.content))) {
    for (const message of Object.values(doc.content?.components?.messages ?? {})) {
      if (message?.name && !events.has(message.name)) {
        events.set(message.name, { summary: message.summary ?? '', example: message.examples?.[0]?.payload ?? null });
      }
    }
  }
  // The events timers call back with.
  const callbacks = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.callback?.event === 'string') callbacks.add(node.callback.event);
    for (const value of Object.values(node)) walk(value);
  };
  for (const doc of docs.filter((d) => d.type === 'state-machine')) walk(doc.content);
  return { events, callbacks: [...callbacks].sort(), operations: calledOperations(docs, operationsIn(docs, records)), channels: channelsIn(docs) };
}

/**
 * The form for one event stub, new or one already registered.
 *
 * @param {{ choices: ReturnType<typeof stubChoices>, waiting: object[], stub?: object,
 *   save: (stub: object) => Promise<string|null>, cancel: () => void }} options -
 *   What to offer; the timers waiting now, whose ids are offered to match; the
 *   stub to edit, if any; `save`, which registers it and answers an error, or
 *   null; and `cancel`
 * @returns {HTMLElement}
 */
export function eventStubForm({ choices, waiting, stub = null, save, cancel }) {
  const state = {
    on: stub?.on ?? '',
    match: Object.entries(stub?.match ?? {}).map(([path, value]) => [path, typeof value === 'string' ? value : JSON.stringify(value)]),
    reply: stub?.response?.type ?? '',
    data: pretty(stub?.response?.data),
  };
  const timer = () => state.on === TIMER_REQUESTED;
  const built = () => {
    const out = { on: state.on };
    const match = matchOf(state);
    if (Object.keys(match).length) out.match = match;
    if (!timer() && state.reply) {
      out.response = { type: state.reply };
      if (state.data.trim()) out.response.data = typed(state.data);
    }
    return out;
  };
  return formShell({
    stub,
    // A stub the form can't say all of opens as JSON.
    opensAsJson: Boolean(stub?.response && Object.keys(stub.response).some((key) => !['type', 'data'].includes(key))),
    built,
    ready: () => Boolean(state.on && (timer() || state.reply)),
    save,
    cancel,
    fields: (box, redraw, preview) => {
      box.append(el('label', 'When this event is published'));
      eventPicker(box, state.on, choices.events, (type) => { state.on = type; state.match = []; redraw(); });
      if (choices.events.get(state.on)?.summary) box.append(el('p', choices.events.get(state.on).summary, 'se-hint'));
      if (!state.on) return;

      box.append(el('label', timer() ? 'Only these timers' : 'Only if'));
      const example = choices.events.get(state.on)?.example;
      conditionRows(box, state, {
        paths: timer() ? ['data.callback.event', 'data.timerId']
          : pathsIn(example).map(([path]) => path).filter((path) => !ENVELOPE.has(path.split('.')[0])),
        suggestions: (path) => (path === 'data.callback.event' ? choices.callbacks
          : path === 'data.timerId' ? waiting.map((request) => request.data?.timerId).filter(Boolean)
            : pathsIn(example).filter(([p]) => p === path).map(([, value]) => String(value))),
        redraw,
        preview,
      });
      if (!state.match.length) {
        box.append(el('p', timer() ? 'With no condition, it fires a waiting timer, or else the next one asked for.'
          : 'With no condition, it answers any event of this type.', 'se-hint'));
      }

      if (timer()) {
        box.append(el('label', 'Then'), el('p', 'It sends the timer\'s own callback, standing in for the timer service. It fires one timer, then it\'s used up.', 'se-hint'));
        return;
      }
      box.append(el('label', 'Then publish'));
      eventPicker(box, state.reply, choices.events, (type) => {
        state.reply = type;
        state.data = pretty(choices.events.get(type)?.example?.data);
        redraw();
      });
      if (state.reply) {
        box.append(el('label', 'With this data'));
        const data = el('textarea');
        data.value = state.data;
        data.oninput = () => { state.data = data.value; preview(); };
        box.append(data, el('p', 'Started from the event\'s example. Leave a field out to keep the answered event\'s value. A field here is sent as written.', 'se-hint'));
      }
      box.append(el('p', 'It answers one event, then it\'s used up.', 'se-hint'));
    },
  });
}

// ── HTTP stubs ────────────────────────────────────────────────────────────────

/** The path an OpenAPI document's operations are served under by the mock: its local server's. */
const basePathOf = (content) => {
  const servers = content?.servers ?? [];
  const server = servers.find((s) => /localhost|127\.0\.0\.1/.test(s.url)) ?? servers[0];
  try { return new URL(server?.url ?? '', 'http://relative.invalid').pathname.replace(/\/$/, ''); } catch { return ''; }
};

/**
 * A response's example body: the one it documents, else the schema's, else
 * the first sample record of the schema it answers with.
 */
const exampleBody = (response, content, records) => {
  const media = local(response, content)?.content?.['application/json'];
  if (!media) return undefined;
  if (media.example !== undefined) return media.example;
  const first = Object.values(media.examples ?? {})[0];
  if (first) return local(first, content)?.value;
  const schema = local(media.schema, content);
  if (schema?.example !== undefined) return schema.example;
  if (schema?.examples?.[0] !== undefined) return schema.examples[0];
  const named = typeof media.schema?.$ref === 'string' ? media.schema.$ref.split('/').pop() : null;
  return named ? records[named]?.[0]?.data : undefined;
};

/**
 * Whether the mock has nothing to run for a POST, and so answers it 501 unless
 * a stub stands in: one that creates no record, acts on none, and evaluates no
 * ruleset — a call to another service, such as an adapter's. The same test
 * the mock makes (blueprint-mock-server's spec-loader.js, `isCall`).
 */
const callsOut = (doc, path, rulePaths) => {
  const resources = doc.model?.()?.resources ?? [];
  const collections = [...resources, ...resources.flatMap((r) => r.singletons ?? [])].map((r) => r.path('collection'));
  return !collections.includes(path)
    && !resources.some((r) => path.startsWith(`${r.path('item')}/`))
    && !rulePaths.has(`${doc.domain} ${path}`);
};

/** Every operation the contracts declare, with its documented answers, by API. */
function operationsIn(docs, records) {
  const operations = [];
  // The paths rulesets are evaluated at, which the mock answers itself.
  const rulePaths = new Set(docs.filter((d) => d.type === 'rules').flatMap((d) => Object.values(d.content?.rulesets ?? {})
    .map((ruleset) => ruleset?.endpoint?.path).filter(Boolean).map((path) => `${d.domain} ${path}`)));
  for (const doc of docs.filter((d) => d.type === 'openapi')) {
    const content = doc.content ?? {};
    const base = basePathOf(content);
    for (const [path, item] of Object.entries(content.paths ?? {})) {
      for (const method of METHODS) {
        const operation = item?.[method];
        if (!operation) continue;
        const template = `${base}${path}`;
        operations.push({
          key: `${method.toUpperCase()} ${template}`,
          operationId: operation.operationId,
          callsOut: method === 'post' && callsOut(doc, path, rulePaths),
          api: content.info?.title ?? doc.relativePath,
          method: method.toUpperCase(),
          template,
          summary: operation.summary ?? '',
          answers: Object.entries(operation.responses ?? {}).filter(([status]) => /^\d{3}$/.test(status))
            .map(([status, response]) => ({ status: Number(status), body: exampleBody(response, content, records) })),
        });
      }
    }
  }
  return operations;
}

/**
 * The calls to other services a state machine's steps make, each with who
 * makes it: the ones a flow needs a stub for, since the mock can't answer
 * them itself. A call names an operation by
 * its `operationId` or by its method and path (`POST: eligibility/determinations`);
 * one that names a procedure, or is worked out as it runs (`$...`), isn't one.
 */
function calledOperations(docs, operations) {
  const callers = new Map();
  const calledBy = (operation, caller) => {
    if (!operation) return;
    if (!callers.has(operation.key)) callers.set(operation.key, new Set());
    callers.get(operation.key).add(caller);
  };
  const find = (call) => {
    if (typeof call?.operationId === 'string') return operations.find((o) => o.operationId === call.operationId);
    const method = METHODS.find((m) => typeof call?.[m.toUpperCase()] === 'string');
    if (!method) return null;
    // A path's `$...` parts stand where a template has its `{...}` parameters.
    const parts = `/${call[method.toUpperCase()].replace(/^\//, '')}`.split('/');
    return operations.find((o) => {
      const template = o.template.split('/');
      return o.method === method.toUpperCase() && template.length === parts.length
        && template.every((part, i) => part === parts[i] || (/^\{.+\}$/.test(part) && parts[i].startsWith('$')));
    });
  };
  const walk = (node, caller) => {
    if (!node || typeof node !== 'object') return;
    if (node.call && typeof node.call === 'object') calledBy(find(node.call), caller);
    for (const value of Object.values(node)) walk(value, caller);
  };
  for (const doc of docs.filter((d) => d.type === 'state-machine')) {
    for (const machine of doc.content?.machines ?? []) {
      const object = machine.object ?? doc.content.domain;
      for (const action of machine.actions ?? []) walk(action, `${object} › ${action.id}`);
      for (const reaction of machine.on ?? []) walk(reaction, `${object} › on ${reaction.type}`);
      for (const procedure of machine.procedures ?? []) walk(procedure, `${object} › ${procedure.id}`);
    }
  }
  return operations.filter((o) => o.callsOut && callers.has(o.key)).map((o) => ({ ...o, callers: [...callers.get(o.key)].sort() }));
}

/** The operation a path was written from, and its parameters' values. */
const operationFor = (operations, method, url) => {
  for (const operation of operations) {
    if (method && operation.method !== method.toUpperCase()) continue;
    const names = [...operation.template.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    const pattern = new RegExp(`^${operation.template.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{[^}]+\\?\}/g, '([^/]+)')}$`);
    const found = pattern.exec(url);
    if (found) return { operation, values: Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(found[i + 1])])) };
  }
  return null;
};

/**
 * The form for one HTTP stub.
 *
 * @param {{ choices: ReturnType<typeof stubChoices>, stub?: object, save: (stub: object) => Promise<string|null>, cancel: () => void }} options
 * @returns {HTMLElement}
 */
export function httpStubForm({ choices, stub = null, save, cancel }) {
  const { operations } = choices;
  const written = stub ? operationFor(operations, stub.match?.method, (stub.match?.domain ? `/${stub.match.domain}` : '') + (stub.match?.url ?? '')) : null;
  const state = {
    key: written?.operation.key ?? '',
    values: written?.values ?? {},
    status: stub?.response?.status ?? '',
    body: pretty(stub?.response?.body),
  };
  const chosen = () => operations.find((operation) => operation.key === state.key);
  const url = () => (chosen()?.template ?? '').replace(/\{([^}]+)\}/g, (_, name) => encodeURIComponent(state.values[name] ?? '') || `{${name}}`);
  const built = () => {
    const out = { match: { method: chosen()?.method, url: url() } };
    if (state.status !== '' || state.body.trim()) {
      out.response = {};
      if (state.status !== '') out.response.status = Number(state.status);
      if (state.body.trim()) out.response.body = typed(state.body);
    }
    return out;
  };
  return formShell({
    stub,
    opensAsJson: Boolean(stub && !written),
    built,
    ready: () => Boolean(chosen() && !/\{[^}]+\}/.test(url())),
    save,
    cancel,
    fields: (box, redraw, preview) => {
      box.append(el('label', 'When this is called'));
      const picker = el('select');
      picker.append(Object.assign(el('option', 'Pick an operation…'), { value: '' }));
      for (const api of [...new Set(operations.map((operation) => operation.api))]) {
        const group = Object.assign(el('optgroup'), { label: api });
        for (const operation of operations.filter((o) => o.api === api)) {
          group.append(Object.assign(el('option', `${operation.key}${operation.summary ? ` — ${operation.summary}` : ''}`), { value: operation.key }));
        }
        picker.append(group);
      }
      picker.value = state.key;
      picker.onchange = () => {
        state.key = picker.value;
        state.values = {};
        const first = chosen()?.answers.find((answer) => answer.status < 300) ?? chosen()?.answers[0];
        state.status = first?.status ?? '';
        state.body = pretty(first?.body);
        redraw();
      };
      box.append(picker);
      if (!chosen()) {
        box.append(el('p', operations.length
          ? 'These are the calls state machines make to other services, such as adapters. The mock can\'t answer them itself; without a stub, the call is answered 501. The step goes on with the stub\'s answer.'
          : 'No state machine here calls another service, so there\'s nothing to stub.', 'se-hint'));
        return;
      }
      box.append(el('p', `Called by ${chosen().callers.join(', ')}.`, 'se-hint'));
      // Each of the path's parameters, since a stub matches one exact path.
      for (const [, name] of chosen().template.matchAll(/\{([^}]+)\}/g)) {
        const row = el('div', '', 'se-row');
        const value = Object.assign(el('input'), { value: state.values[name] ?? '', placeholder: 'value…' });
        value.oninput = () => { state.values[name] = value.value; preview(); };
        value.onchange = redraw;
        row.append(el('span', name, 'se-name'), value);
        box.append(row);
      }
      box.append(el('p', `It answers ${chosen().method} ${url()} only.`, 'se-hint'));

      box.append(el('label', 'Answer with'));
      const statuses = chosen().answers.map((answer) => [String(answer.status), String(answer.status)]);
      const status = select(String(state.status), statuses, 'The default: 200');
      status.onchange = () => {
        state.status = status.value === '' ? '' : Number(status.value);
        state.body = pretty(chosen().answers.find((answer) => answer.status === state.status)?.body);
        redraw();
      };
      const body = el('textarea');
      body.value = state.body;
      body.placeholder = 'The body, as JSON. Empty answers {}.';
      body.oninput = () => { state.body = body.value; preview(); };
      box.append(status, body, el('p', 'Started from the response\'s example, or a sample record of what it answers with. It answers one such call, then it\'s used up.', 'se-hint'));
    },
  });
}

// ── WebSocket stubs ───────────────────────────────────────────────────────────

/** A message's payload, filled in as far as its schema says: constants, then empty values by type. */
const skeleton = (schema, content, depth = 0) => {
  const resolved = local(schema, content) ?? {};
  if (resolved.const !== undefined) return resolved.const;
  if (resolved.default !== undefined) return resolved.default;
  if (Array.isArray(resolved.enum)) return resolved.enum[0];
  if (resolved.type === 'object' || resolved.properties) {
    if (depth > 3) return {};
    return Object.fromEntries((resolved.required ?? Object.keys(resolved.properties ?? {}).slice(0, 1))
      .map((name) => [name, skeleton(resolved.properties?.[name], content, depth + 1)]));
  }
  if (resolved.type === 'array') {
    return Array.from({ length: resolved.minItems ?? 0 }, () => skeleton(resolved.items, content, depth + 1));
  }
  return { string: '', number: 0, integer: 0, boolean: false }[resolved.type] ?? null;
};

/** Each WebSocket channel, with the messages the mock receives and sends on it. */
function channelsIn(docs) {
  const channels = [];
  for (const doc of docs.filter((d) => d.type === 'asyncapi' && overWebSocket(d.content))) {
    const content = doc.content ?? {};
    const file = String(doc.relativePath ?? '').split('/').pop();
    for (const [key, channel] of Object.entries(content.channels ?? {})) {
      const named = (ref) => (typeof ref?.$ref === 'string' ? ref.$ref.split('/').pop() : null);
      const receives = new Set();
      const sends = new Set();
      for (const operation of Object.values(content.operations ?? {})) {
        if (operation?.channel?.$ref !== `#/channels/${key}`) continue;
        for (const message of operation.messages ?? []) (operation.action === 'receive' ? receives : sends).add(named(message));
        for (const message of operation.reply?.messages ?? []) sends.add(named(message));
      }
      const payloadOf = (name) => local(channel.messages?.[name], content)?.payload;
      channels.push({
        value: `${file}#/channels/${key}`,
        label: `${content.info?.title ?? file} › ${key}`,
        receives: [...receives].filter(Boolean),
        sends: [...sends].filter(Boolean),
        summaryOf: (name) => local(channel.messages?.[name], content)?.summary ?? '',
        fieldsOf: (name) => Object.keys(local(payloadOf(name), content)?.properties ?? {}).filter((field) => field !== 'type'),
        exampleOf: (name) => skeleton(payloadOf(name), content),
      });
    }
  }
  return channels;
}

const CLOSES = [['', 'Leave it open'], ['1006', 'Drop it (1006)'], ['1008', 'Refuse it (1008)'], ['1000', 'Close it normally (1000)']];

/**
 * The form for one WebSocket stub.
 *
 * @param {{ choices: ReturnType<typeof stubChoices>, stub?: object, save: (stub: object) => Promise<string|null>, cancel: () => void }} options
 * @returns {HTMLElement}
 */
export function wsStubForm({ choices, stub = null, save, cancel }) {
  const { channels } = choices;
  const state = {
    channel: stub?.channel ?? '',
    on: stub?.on ?? '',
    match: Object.entries(stub?.match ?? {}).map(([path, value]) => [path, typeof value === 'string' ? value : JSON.stringify(value)]),
    send: (stub?.send ?? []).map((message, i) => ({ name: message?.type ?? '', body: pretty(message), at: stub?.atMs?.[i] ?? '' })),
    close: stub?.close ? String(stub.close.code) : '',
  };
  const chosen = () => channels.find((channel) => channel.value === state.channel);
  const built = () => {
    const out = { channel: state.channel, on: state.on };
    const match = matchOf(state);
    if (Object.keys(match).length) out.match = match;
    if (state.send.length) {
      out.send = state.send.map((message) => typed(message.body));
      if (state.send.some((message) => message.at !== '')) out.atMs = state.send.map((message) => Number(message.at || 0));
    }
    if (state.close) out.close = { code: Number(state.close) };
    return out;
  };
  return formShell({
    stub,
    opensAsJson: Boolean(stub && (stub.protocols || stub.close?.reason || stub.close?.atMs !== undefined
      || !channels.some((channel) => channel.value === stub.channel))),
    built,
    ready: () => Boolean(chosen() && state.on),
    save,
    cancel,
    fields: (box, redraw, preview) => {
      box.append(el('label', 'On this connection'));
      const channel = select(state.channel, channels.map((c) => [c.value, c.label]), channels.length ? 'Pick a channel…' : 'The contracts declare none');
      channel.onchange = () => { state.channel = channel.value; state.on = ''; state.match = []; state.send = []; redraw(); };
      box.append(channel);
      if (!chosen()) return;

      box.append(el('label', 'When the mock receives'));
      const on = select(state.on, chosen().receives, 'Pick a message…');
      on.onchange = () => { state.on = on.value; state.match = []; redraw(); };
      box.append(on);
      if (!state.on) return;
      if (chosen().summaryOf(state.on)) box.append(el('p', chosen().summaryOf(state.on), 'se-hint'));

      box.append(el('label', 'Only if'));
      conditionRows(box, state, { paths: chosen().fieldsOf(state.on), redraw, preview });

      box.append(el('label', 'Send back'));
      for (const [index, message] of state.send.entries()) {
        const part = el('div', '', 'se-message');
        const row = el('div', '', 'se-row');
        const name = select(message.name, chosen().sends, 'Pick a message…');
        name.onchange = () => { state.send[index] = { name: name.value, body: pretty(chosen().exampleOf(name.value)), at: message.at }; redraw(); };
        const at = Object.assign(el('input', '', 'se-ms'), { value: message.at, placeholder: 'after ms', type: 'number', min: 0 });
        at.oninput = () => { state.send[index].at = at.value; preview(); };
        const remove = Object.assign(el('button', '×', 'se-x'), { type: 'button', title: 'Remove this message' });
        remove.onclick = () => { state.send.splice(index, 1); redraw(); };
        row.append(name, at, remove);
        const body = el('textarea');
        body.value = message.body;
        body.oninput = () => { state.send[index].body = body.value; preview(); };
        part.append(row, body);
        box.append(part);
      }
      const add = Object.assign(el('button', '+ Add a message', 'se-link'), { type: 'button' });
      add.onclick = () => { state.send.push({ name: '', body: '', at: '' }); redraw(); };
      box.append(add, el('p', 'Each starts from the message\'s schema. A time sends it that many milliseconds after the stub matches; none sends them all at once.', 'se-hint'));

      box.append(el('label', 'Then'));
      const close = select(state.close, CLOSES, null);
      close.onchange = () => { state.close = close.value; preview(); };
      box.append(close, el('p', 'It answers one such message, then it\'s used up.', 'se-hint'));
    },
  });
}

// ── In words ──────────────────────────────────────────────────────────────────

const where = (match) => {
  const conditions = Object.entries(match ?? {}).map(([path, value]) => `${path} = ${JSON.stringify(value)}`);
  return conditions.length ? ` where ${conditions.join(' and ')}` : '';
};

/** A stub said in words: When … where … then …. */
export function describeStub(kind, stub) {
  if (kind === 'http') {
    const path = `${stub.match?.domain ? `/${stub.match.domain}` : ''}${stub.match?.url ?? ''}`;
    return `${stub.match?.method ?? 'Any method'} ${path}: answer ${stub.response?.status ?? 200}`;
  }
  if (kind === 'ws') {
    const sends = (stub.send ?? []).map((message) => message?.type ?? 'a message');
    return `On ${String(stub.channel).split('#/channels/').pop()}, when ${stub.on} is received${where(stub.match)}, `
      + `${sends.length ? `send ${sends.join(', ')}` : 'send nothing'}${stub.close ? `, then close (${stub.close.code})` : ''}`;
  }
  if (stub.on === TIMER_REQUESTED) return `Fire a timer${where(stub.match)}`;
  return `When ${stub.on}${where(stub.match)}, ${stub.response?.type ? `publish ${stub.response.type}` : 'do nothing'}`;
}

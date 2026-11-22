/**
 * Try it for an API reached over a WebSocket, such as the transcript relay:
 * connect, send the messages it receives, stream a recording as its binary
 * audio, and watch what comes back.
 *
 * The connection is the mock's in-page WebSocket (blueprint-mock-server's
 * ws.js), so the mock checks every message both ways against the contract,
 * answers with the WebSocket stubs the control panel registers, and, where the
 * site's routing sends the API to a real service, passes the connection on.
 * Its controls go in the page's cards, one per thing that can be sent, shown
 * with Try it on; what goes each way is in the control panel's activity log
 * (activity.js). The Send panels' module mounts it (send-panel.js), so it
 * shares their mock and control panel.
 */

import { decodeRecording, streamRecording, WRITABLE } from './audio.js';
import { addStub, mockChanged } from './control-panel.js';
import { logConnection, logMessage, logClose } from './activity.js';
import { tryView } from './try-view.js';

const el = (tag, text = '', className = '') => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
};

export const SOCKET_STYLE = `
  html:not([data-try-it="on"]) .socket-send { display: none; }
  .socket-send { margin-top: 12px; }
  .socket-send .try-params { margin-bottom: 6px; }
  .socket-send .note { font-size: 11.5px; color: #666; margin-top: 4px; }
  .socket-send .note.bad { color: #b42318; }
  .socket-send .note button { margin-left: 8px; font: 600 11px system-ui, sans-serif; padding: 1px 10px; border-radius: 3px; border: 1px solid #2B1A78; background: #fff; color: #2B1A78; cursor: pointer; }
  .socket-send .try-code pre { white-space: pre-wrap; }
  .socket-send .try-code .foot .state { color: #c7c4ea; font: 12px system-ui, sans-serif; margin-right: auto; }
  .socket-send .try-code .foot .state.open { color: #86efac; font-weight: 600; }
  .socket-send .try-code .send.quiet { background: transparent; color: #fff; border: 1px solid #8b86b8; }
`;

/** A node with its same-document `$ref`s followed. */
const local = (doc, node) => {
  for (let hops = 0; typeof node?.$ref === 'string' && node.$ref.startsWith('#/') && hops < 8; hops += 1) {
    node = node.$ref.slice(2).split('/').map((key) => key.replace(/~1/g, '/').replace(/~0/g, '~')).reduce((at, key) => at?.[key], doc.content);
  }
  return node;
};

/**
 * A schema with its `$ref`s followed, into other documents of the set too,
 * and the document it was found in, which its own `$ref`s are relative to.
 */
const followed = (doc, node, docs) => {
  const at = local(doc, node);
  if (typeof at?.$ref !== 'string') return { doc, node: at };
  const file = at.$ref.split('#')[0].split('/').pop();
  const there = docs.find((d) => String(d.relativePath ?? '').split('/').pop() === file) ?? doc;
  return { doc: there, node: local(there, doc.resolveRef(at.$ref, docs)) };
};

/**
 * A payload to start from, built from its schema: a fixed value, an example,
 * the first allowed value or the default, and of an object, its required
 * fields.
 */
export function sampleOf(from, schema, docs, depth = 0) {
  const { doc, node } = followed(from, schema, docs);
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (node.const !== undefined) return node.const;
  if (node.example !== undefined) return node.example;
  if (node.examples?.length) return node.examples[0];
  if (node.default !== undefined) return node.default;
  if (node.enum?.length) return node.enum[0];
  if (node.type === 'object' || node.properties) {
    const required = new Set(node.required ?? []);
    return Object.fromEntries(Object.entries(node.properties ?? {})
      .filter(([name]) => required.has(name))
      .map(([name, property]) => [name, sampleOf(doc, property, docs, depth + 1)]));
  }
  if (node.type === 'array') return Array.from({ length: node.minItems ?? 0 }, () => sampleOf(doc, node.items, docs, depth + 1));
  return { string: '', number: 0, integer: 0, boolean: false }[node.type] ?? null;
}

/** Whether a message travels as binary frames. */
const isBinary = (message) => message.contentType === 'application/octet-stream' || message.payload?.format === 'binary';

/**
 * The messages a document's server receives, which Try it sends: each once,
 * by name, with its payload and the example to start from.
 */
export function messagesToSend(doc, docs) {
  const found = new Map();
  for (const operation of Object.values(doc.content?.operations ?? {})) {
    if (operation?.action !== 'receive') continue;
    for (const ref of operation.messages ?? []) {
      const message = local(doc, ref);
      const name = message?.name ?? String(ref?.$ref ?? '').split('/').pop();
      if (!message || found.has(name)) continue;
      found.set(name, {
        name,
        summary: message.summary ?? '',
        binary: isBinary(message),
        start: message.examples?.[0]?.payload ?? sampleOf(doc, message.payload, docs),
      });
    }
  }
  return [...found.values()];
}

/** Where the mock serves the document: its localhost server, and the channel's address. */
export function localUrl(doc) {
  const server = Object.values(doc.content?.servers ?? {}).find((s) => /^localhost(:|$)/.test(String(s?.host ?? '')));
  if (!server) return null;
  const channel = Object.values(doc.content?.channels ?? {})[0];
  const address = channel?.address ? `/${String(channel.address).replace(/^\//, '')}` : '';
  return `${server.protocol}://${server.host}${String(server.pathname ?? '').replace(/\/$/, '')}${address}`;
}

/**
 * The audio format the software declared, from the last message it sent that
 * gave one: an object with an encoding and a sample rate, as the blueprint's
 * AudioFormat is (communication-transcripts-schema.yaml).
 */
export function declaredFormat(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.encoding === 'string' && Number.isInteger(payload.sampleRateHertz)) {
    return { encoding: payload.encoding, sampleRateHertz: payload.sampleRateHertz, channelCount: payload.channelCount ?? 1 };
  }
  for (const value of Object.values(payload)) {
    const found = declaredFormat(value);
    if (found) return found;
  }
  return null;
}

/**
 * The WebSocket stub the mock needs when it closes with 1011: the channel the
 * message is on, in the stub editor's terms, and the message, which the
 * close's reason names first (blueprint-mock-server's ws.js).
 */
export function stubNeeded(doc, reason) {
  const on = /^(\S+) is answered with /.exec(reason ?? '')?.[1];
  if (!on) return null;
  const key = Object.entries(doc.content?.channels ?? {}).find(([, channel]) => channel?.messages?.[on])?.[0];
  if (!key) return null;
  return { channel: `${String(doc.relativePath ?? '').split('/').pop()}#/channels/${key}`, on };
}

/**
 * Try it on a WebSocket API's page: each card it can send from gets its
 * controls, styled as Send's are on an operation (send-panel.js), shown with
 * Try it on, the card's docs folded under its description (try-view.js).
 * The connection and every message each way go in the control panel's
 * activity log; a message the mock had no answer for offers, on its card,
 * the WebSocket stub that gives one.
 *
 * @param {HTMLElement} holder - Around the page's cards, marked `data-try-socket` with the document's relativePath
 * @param {{ docs: object[], mock: () => object, realTag: (tag: HTMLElement, doc: object) => void, where: { scope: string } }} context -
 *   The contract set's documents; the page's mock, as it is now; where to
 *   register the tag shown when the site's routing sends the API to a real
 *   service; and where the tab keeps its activity log
 */
export function mountSocketPanel(holder, { docs, mock, realTag, where }) {
  const doc = docs.find((d) => d.relativePath === holder.dataset.trySocket);
  if (!doc) return;
  const messages = messagesToSend(doc, docs);

  let socket = null;
  let connection = null;
  let format = null;
  let streaming = null;
  const isOpen = () => socket?.readyState === 1;
  const refreshers = [];
  const refresh = () => { for (const step of refreshers) step(); };
  // Each card's note, by the message it sends, for a stub it needs.
  const notes = new Map();
  /** Something to log, and the control panel shown again. */
  const logged = (step) => { step(); mockChanged(); };

  /** A dark block as Send's: what's sent, and the buttons under it. */
  const codeBlock = (content, ...footer) => {
    const code = el('div', '', 'try-code');
    const pre = el('pre');
    pre.append(content);
    const foot = el('div', '', 'foot');
    foot.append(...footer);
    code.append(pre, foot);
    return code;
  };
  const sendButton = (text, quiet = false) => Object.assign(el('button', text, `send${quiet ? ' quiet' : ''}`), { type: 'button' });
  const field = (label, input) => {
    const row = el('div', '', 'row');
    row.append(el('label', label), input);
    return row;
  };
  /** Controls in a card, which with Try it on shows them and folds its docs. */
  const mount = (place, wrap) => {
    place.replaceChildren(wrap);
    const card = place.closest('.content-item');
    if (card) tryView(card);
  };

  // Connect: the URL and subprotocols, and the request they make.
  for (const place of holder.querySelectorAll('[data-socket-connect]')) {
    const wrap = el('div', '', 'socket-send');
    const url = Object.assign(el('input'), { type: 'text', value: localUrl(doc) ?? '', autocomplete: 'off' });
    const protocols = Object.assign(el('input'), { type: 'text', placeholder: 'comma-separated, as the API asks for them', autocomplete: 'off' });
    const params = el('div', '', 'try-params');
    params.append(field('URL', url), field('Subprotocols', protocols));
    const request = el('span');
    const button = sendButton('Connect');
    const state = el('span', 'Not connected', 'state');
    const real = Object.assign(el('span', 'Real service', 'real'), { hidden: true });
    realTag(real, doc);
    const note = el('div', '', 'note');
    const offered = () => protocols.value.split(',').map((p) => p.trim()).filter(Boolean);
    const shown = () => {
      const at = (() => { try { return new URL(url.value.trim()); } catch { return null; } })();
      request.textContent = `GET ${at ? `${at.pathname}${at.search}` : url.value.trim()} HTTP/1.1\nHost: ${at?.host ?? ''}\nUpgrade: websocket\nConnection: Upgrade${offered().length ? `\nSec-WebSocket-Protocol: ${offered().join(', ')}` : ''}`;
    };
    url.addEventListener('input', shown);
    protocols.addEventListener('input', shown);
    shown();
    button.addEventListener('click', () => connect(url.value.trim(), offered(), note));
    refreshers.push(() => {
      button.disabled = Boolean(socket);
      url.disabled = protocols.disabled = Boolean(socket);
      state.textContent = isOpen() ? 'Connected' : socket ? 'Connecting…' : 'Not connected';
      state.className = `state${isOpen() ? ' open' : ''}`;
    });
    wrap.append(params, codeBlock(request, state, real, button), note);
    mount(place, wrap);
  }

  // Each message the server receives: its body, or for audio, a recording.
  for (const place of holder.querySelectorAll('[data-socket-send]')) {
    const message = messages.find((m) => m.name === place.dataset.socketSend);
    if (!message) continue;
    const wrap = el('div', '', 'socket-send');
    const note = el('div', '', 'note');
    notes.set(message.name, note);
    if (message.binary) {
      const file = Object.assign(el('input'), { type: 'file', accept: 'audio/*' });
      const params = el('div', '', 'try-params');
      params.append(field('Recording', file));
      const stream = sendButton('Stream');
      const stop = Object.assign(sendButton('Stop', true), { hidden: true });
      const said = el('span', 'Frames of the recording, in the format the message that declared one gave, at the pace it was spoken.');
      file.addEventListener('change', () => { note.textContent = ''; refresh(); });
      stream.addEventListener('click', () => streamFile(message.name, file.files[0], note));
      stop.addEventListener('click', () => streaming?.stop());
      refreshers.push(() => { stream.disabled = !isOpen() || !file.files?.length || Boolean(streaming); stop.hidden = !streaming; });
      wrap.append(params, codeBlock(said, stop, stream), note);
    } else {
      // Edited where it's shown, as Send's body is.
      const body = el('span', '', 'body-edit');
      body.contentEditable = 'plaintext-only';
      body.spellcheck = false;
      body.textContent = JSON.stringify(message.start ?? {}, null, 2);
      const button = sendButton('Send');
      button.addEventListener('click', () => sendJson(message.name, body.textContent, note));
      refreshers.push(() => { button.disabled = !isOpen(); });
      wrap.append(codeBlock(body, button), note);
    }
    mount(place, wrap);
  }

  // Disconnect: the close frame's code and reason.
  for (const place of holder.querySelectorAll('[data-socket-close]')) {
    const wrap = el('div', '', 'socket-send');
    const code = Object.assign(el('input'), { type: 'text', value: '1000', autocomplete: 'off' });
    const reason = Object.assign(el('input'), { type: 'text', value: 'Closed from Try it', autocomplete: 'off' });
    const params = el('div', '', 'try-params');
    params.append(field('Code', code), field('Reason', reason));
    const frame = el('span');
    const shown = () => { frame.textContent = `close ${code.value.trim()}${reason.value.trim() ? ` "${reason.value.trim()}"` : ''}`; };
    code.addEventListener('input', shown);
    reason.addEventListener('input', shown);
    shown();
    const note = el('div', '', 'note');
    const button = sendButton('Disconnect');
    button.addEventListener('click', () => {
      note.textContent = '';
      try {
        socket?.close(Number(code.value.trim()), reason.value.trim());
      } catch (error) {
        note.textContent = `Not closed: ${error.message}`;
        note.className = 'note bad';
      }
    });
    refreshers.push(() => { button.disabled = !socket; });
    wrap.append(params, codeBlock(frame, button), note);
    mount(place, wrap);
  }

  // ── The connection ───────────────────────────────────────────────────────
  function connect(url, offered, note) {
    if (socket) return;
    note.textContent = '';
    note.className = 'note';
    for (const each of notes.values()) each.replaceChildren();
    format = null;
    try {
      socket = new (mock().WebSocket)(url, offered);
    } catch (error) {
      note.textContent = `Not connected: ${error.message}`;
      note.className = 'note bad';
      socket = null;
      refresh();
      return;
    }
    const mine = socket;
    socket.binaryType = 'arraybuffer';
    logged(() => { connection = logConnection(where, { url, protocols: offered }); });
    const at = connection;
    socket.addEventListener('open', refresh);
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') {
        logged(() => logMessage(where, at, { sent: false, name: 'binary', said: `binary, ${event.data.byteLength} bytes` }));
        return;
      }
      let payload;
      try { payload = JSON.parse(event.data); } catch { payload = event.data; }
      logged(() => logMessage(where, at, { sent: false, name: payload?.type ?? 'message', payload }));
    });
    socket.addEventListener('close', (event) => {
      logged(() => logClose(where, at, { code: event.code, reason: event.reason }));
      // The mock had no answer: the card of the message it didn't answer offers the stub that gives one.
      const needed = event.code === 1011 ? stubNeeded(doc, event.reason) : null;
      const card = needed ? notes.get(needed.on) : null;
      if (card) {
        card.className = 'note bad';
        card.replaceChildren(`The mock closed the connection (1011): nothing answers ${needed.on} without a WebSocket stub.`);
        const add = Object.assign(el('button', 'Add a WebSocket stub for it'), { type: 'button' });
        add.addEventListener('click', () => addStub('ws', needed));
        card.append(add);
      }
      streaming?.stop();
      if (socket === mine) socket = null;
      refresh();
    });
    refresh();
  }

  function sendJson(name, text, note) {
    note.textContent = '';
    note.className = 'note';
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      note.textContent = `Not JSON: ${error.message}`;
      note.className = 'note bad';
      return;
    }
    socket.send(JSON.stringify(payload));
    logged(() => logMessage(where, connection, { sent: true, name, payload }));
    format = declaredFormat(payload) ?? format;
  }

  async function streamFile(name, file, note) {
    note.className = 'note';
    if (!format) {
      note.textContent = 'Send the message that declares the audio\'s format first, such as start: the audio goes in that format.';
      note.className = 'note bad';
      return;
    }
    if (!WRITABLE.includes(format.encoding)) {
      note.textContent = `Try it sends ${WRITABLE.join(' or ')} audio, and the format sent declares ${format.encoding}. Declare ${WRITABLE[0]} to send a recording.`;
      note.className = 'note bad';
      return;
    }
    note.textContent = 'Decoding…';
    let recording;
    try {
      recording = await decodeRecording(await file.arrayBuffer(), format);
    } catch (error) {
      note.textContent = error.message;
      note.className = 'note bad';
      return;
    }
    if (!isOpen()) return;
    const total = recording.seconds.toFixed(1);
    const describe = (sent) => `${file.name}: ${sent.toFixed(1)} of ${total}s sent, as ${format.encoding} at ${format.sampleRateHertz} Hz, ${format.channelCount} channel${format.channelCount === 1 ? '' : 's'}.`;
    note.textContent = describe(0);
    const sending = socket;
    const at = connection;
    let frames = 0;
    let sentSeconds = 0;
    streaming = streamRecording(recording, format.sampleRateHertz, (frame) => {
      if (sending.readyState !== 1) return false;
      sending.send(frame);
      frames += 1;
      return true;
    }, (sent) => { sentSeconds = sent; note.textContent = describe(sent); });
    refresh();
    const how = await streaming.done;
    // The stream, as one line: its frames would be dozens a second.
    logged(() => logMessage(where, at, { sent: true, name, said: `${name}: ${sentSeconds.toFixed(1)}s of ${file.name} in ${frames} frames${how === 'stopped' ? ', stopped' : ''}` }));
    if (how === 'stopped') note.textContent += ' Stopped.';
    streaming = null;
    refresh();
  }

  refresh();
}

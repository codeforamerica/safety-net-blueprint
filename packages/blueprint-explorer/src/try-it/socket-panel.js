/**
 * Try it for an API reached over a WebSocket, such as the transcript relay:
 * connect, send the messages it receives, stream a recording as its binary
 * audio, and watch what comes back.
 *
 * The connection is the mock's in-page WebSocket (blueprint-mock-server's
 * ws.js), so the mock checks every message both ways against the contract,
 * answers with the WebSocket stubs the control panel registers, and, where the
 * site's routing sends the API to a real service, passes the connection on.
 * One panel per page, beside the API's servers; the Send panels' module mounts
 * it (send-panel.js), so it shares their mock and control panel.
 */

import { decodeRecording, streamRecording, WRITABLE } from './audio.js';

const el = (tag, text = '', className = '') => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
};

export const SOCKET_STYLE = `
  .try-socket { border: 1px solid #e3e1f5; border-radius: 6px; padding: 10px 14px; background: #fff; font-size: 12px; }
  .try-socket h3 { font: 700 13px sans-serif; color: #2B1A78; margin: 0 0 8px; }
  .try-socket .row { display: grid; grid-template-columns: 7rem 1fr; gap: 8px; align-items: center; padding: 3px 0; }
  .try-socket .row > label { font: 600 12px sans-serif; color: #333; }
  .try-socket input[type=text], .try-socket select, .try-socket textarea { font: 12px monospace; padding: 4px 6px; border: 1px solid #c7c4ea; border-radius: 4px; width: 100%; box-sizing: border-box; background: #fff; }
  .try-socket textarea { min-height: 6rem; resize: vertical; margin-top: 4px; }
  .try-socket .acts { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .try-socket button { font: 600 12px sans-serif; padding: 4px 14px; border-radius: 4px; border: 0; background: #2B1A78; color: #fff; cursor: pointer; white-space: nowrap; }
  .try-socket button:disabled { opacity: .45; cursor: default; }
  .try-socket button.quiet { background: #fff; color: #2B1A78; border: 1px solid #c7c4ea; }
  .try-socket .real { font: 600 11px system-ui, sans-serif; color: #fff; background: #b45309; padding: 2px 8px; border-radius: 3px; }
  .try-socket .state { color: #666; }
  .try-socket .state.open { color: #15803d; font-weight: 600; }
  .try-socket .note { color: #666; margin-top: 4px; }
  .try-socket .note.bad { color: #b42318; }
  .try-socket .log { margin-top: 10px; background: #1e1b3a; color: #e6e4f5; font: 11.5px/1.5 monospace; border-radius: 4px; padding: 8px 10px; max-height: 22rem; overflow: auto; }
  .try-socket .log:empty { display: none; }
  .try-socket .log div { white-space: pre-wrap; word-break: break-all; }
  .try-socket .log .t { color: #8b86b8; }
  .try-socket .log .out { color: #a5b4fc; }
  .try-socket .log .in { color: #86efac; }
  .try-socket .log .shut { color: #fca5a5; }
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
 * Mount the panel in its holder.
 *
 * @param {HTMLElement} holder - Marked `data-try-socket` with the document's relativePath
 * @param {{ docs: object[], mock: () => object, realTag: (tag: HTMLElement, doc: object) => void }} context -
 *   The contract set's documents; the page's mock, as it is now; and where to
 *   register the tag shown when the site's routing sends the API to a real service
 */
export function mountSocketPanel(holder, { docs, mock, realTag }) {
  const doc = docs.find((d) => d.relativePath === holder.dataset.trySocket);
  if (!doc) return;
  const messages = messagesToSend(doc, docs);
  const json = messages.filter((m) => !m.binary);
  const takesAudio = messages.some((m) => m.binary);

  const box = el('div', '', 'try-socket');
  box.append(el('h3', 'Try it'));

  // ── Connecting ───────────────────────────────────────────────────────────
  const url = Object.assign(el('input'), { type: 'text', value: localUrl(doc) ?? '', autocomplete: 'off' });
  url.setAttribute('aria-label', 'URL');
  const protocols = Object.assign(el('input'), { type: 'text', placeholder: 'Comma-separated, as the API asks for them', autocomplete: 'off' });
  protocols.setAttribute('aria-label', 'Subprotocols');
  const row = (label, ...content) => {
    const line = el('div', '', 'row');
    const holderCell = el('div', '', 'acts');
    holderCell.append(...content);
    // A field fills the row; buttons keep their size.
    line.append(el('label', label), content.length === 1 && content[0].tagName !== 'BUTTON' ? content[0] : holderCell);
    return line;
  };
  const connect = el('button', 'Connect');
  const state = el('span', 'Not connected', 'state');
  const real = el('span', 'Real service', 'real');
  real.hidden = true;
  realTag(real, doc);
  box.append(row('URL', url), row('Subprotocols', protocols), row('', connect, real, state));

  // ── Sending ──────────────────────────────────────────────────────────────
  const pick = el('select');
  pick.setAttribute('aria-label', 'Message');
  for (const message of json) pick.append(Object.assign(el('option', message.summary ? `${message.name} — ${message.summary}` : message.name), { value: message.name }));
  const body = el('textarea');
  body.setAttribute('aria-label', 'Message body');
  body.spellcheck = false;
  const fill = () => { body.value = JSON.stringify(json.find((m) => m.name === pick.value)?.start ?? {}, null, 2); };
  pick.addEventListener('change', fill);
  fill();
  const sendButton = el('button', 'Send message');
  const sendNote = el('div', '', 'note');
  const messageCell = el('div');
  messageCell.append(pick, body);
  if (json.length) box.append(row('Message', messageCell), row('', sendButton), sendNote);

  const file = Object.assign(el('input'), { type: 'file', accept: 'audio/*' });
  file.setAttribute('aria-label', 'Recording');
  const streamButton = el('button', 'Stream audio');
  const stopButton = Object.assign(el('button', 'Stop', 'quiet'), { hidden: true });
  const audioNote = el('div', '', 'note');
  if (takesAudio) box.append(row('Audio', file, streamButton, stopButton), audioNote);

  const log = el('div', '', 'log');
  box.append(log);
  holder.replaceChildren(box);

  // ── The connection ───────────────────────────────────────────────────────
  let socket = null;
  let opened = 0;
  let format = null;
  let streaming = null;
  const stamp = () => `+${((performance.now() - opened) / 1000).toFixed(3)}s`;
  const write = (kind, text) => {
    const line = el('div');
    line.append(el('span', `${stamp()} `, 't'), el('span', text, kind));
    log.append(line);
    log.scrollTop = log.scrollHeight;
    return line;
  };
  const isOpen = () => socket?.readyState === 1;
  const refresh = () => {
    connect.textContent = socket ? 'Disconnect' : 'Connect';
    sendButton.disabled = !isOpen();
    streamButton.disabled = !isOpen() || !file.files?.length || Boolean(streaming);
    stopButton.hidden = !streaming;
    url.disabled = protocols.disabled = Boolean(socket);
    state.textContent = isOpen() ? 'Connected' : socket ? 'Connecting…' : 'Not connected';
    state.className = `state${isOpen() ? ' open' : ''}`;
  };

  connect.addEventListener('click', () => {
    if (socket) { socket.close(1000, 'Closed from Try it'); return; }
    const offered = protocols.value.split(',').map((p) => p.trim()).filter(Boolean);
    log.replaceChildren();
    opened = performance.now();
    format = null;
    try {
      socket = new (mock().WebSocket)(url.value.trim(), offered);
    } catch (error) {
      write('shut', `Not connected: ${error.message}`);
      socket = null;
      refresh();
      return;
    }
    const mine = socket;
    socket.binaryType = 'arraybuffer';
    write('t', `Connecting to ${url.value.trim()}${offered.length ? `, offering ${offered.join(', ')}` : ''}`);
    socket.addEventListener('open', () => { write('t', `Connected${mine.protocol ? `, speaking ${mine.protocol}` : ''}`); refresh(); });
    socket.addEventListener('message', (event) => {
      write('in', typeof event.data === 'string' ? `← ${event.data}` : `← binary, ${event.data.byteLength} bytes`);
    });
    socket.addEventListener('close', (event) => {
      write('shut', `Closed ${event.code}${event.reason ? `: ${event.reason}` : ''}`);
      streaming?.stop();
      if (socket === mine) socket = null;
      refresh();
    });
    refresh();
  });

  sendButton.addEventListener('click', () => {
    sendNote.textContent = '';
    sendNote.className = 'note';
    let payload;
    try {
      payload = JSON.parse(body.value);
    } catch (error) {
      sendNote.textContent = `Not JSON: ${error.message}`;
      sendNote.className = 'note bad';
      return;
    }
    const text = JSON.stringify(payload);
    socket.send(text);
    write('out', `→ ${text}`);
    format = declaredFormat(payload) ?? format;
  });

  file.addEventListener('change', () => { audioNote.textContent = ''; refresh(); });

  streamButton.addEventListener('click', async () => {
    audioNote.className = 'note';
    if (!format) {
      audioNote.textContent = 'Send the message that declares the audio\'s format first, such as start: the audio goes in that format.';
      audioNote.className = 'note bad';
      return;
    }
    if (!WRITABLE.includes(format.encoding)) {
      audioNote.textContent = `Try it sends ${WRITABLE.join(' or ')} audio, and the format sent declares ${format.encoding}. Declare ${WRITABLE[0]} to send a recording.`;
      audioNote.className = 'note bad';
      return;
    }
    audioNote.textContent = 'Decoding…';
    let recording;
    try {
      recording = await decodeRecording(await file.files[0].arrayBuffer(), format);
    } catch (error) {
      audioNote.textContent = error.message;
      audioNote.className = 'note bad';
      return;
    }
    if (!isOpen()) return;
    const total = recording.seconds.toFixed(1);
    audioNote.textContent = `${file.files[0].name}: ${total}s, as ${format.encoding} at ${format.sampleRateHertz} Hz, ${format.channelCount} channel${format.channelCount === 1 ? '' : 's'}, in frames sent as it would be spoken.`;
    const line = write('out', `→ audio, 0.0 of ${total}s`);
    const sending = socket;
    streaming = streamRecording(recording, format.sampleRateHertz, (frame) => {
      if (sending.readyState !== 1) return false;
      sending.send(frame);
      return true;
    }, (sent) => { line.lastChild.textContent = `→ audio, ${sent.toFixed(1)} of ${total}s`; });
    refresh();
    const how = await streaming.done;
    if (how === 'stopped') line.lastChild.textContent += ', stopped';
    streaming = null;
    refresh();
  });

  stopButton.addEventListener('click', () => streaming?.stop());
  refresh();
}

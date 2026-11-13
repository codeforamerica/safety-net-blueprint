/**
 * The messages an AsyncAPI document's operations carry, and checking one
 * against the contract: which of an operation's messages a frame is, or why
 * it is none of them.
 *
 * Shared by the mock, which serves a document's WebSocket and checks what
 * arrives and what it sends, and the Arazzo runner, which checks what it
 * receives. A message's payload is checked against its schema where the
 * document declares it, so refs into other files resolve; a message whose
 * `contentType` is `application/octet-stream` is a binary frame, and any
 * binary frame is it.
 */

import { createAjv, registerDocuments, validatorFor } from './schema-registry.js';

/** The local name a `$ref` ends in: `#/channels/audio/messages/start` → `start`. */
const lastSegment = (ref) => String(ref ?? '').split('/').pop().replace(/~1/g, '/').replace(/~0/g, '~');

/** The node a local `$ref` names in a document. */
function local(content, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
  return ref.slice(2).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((at, key) => at?.[key], content);
}

/**
 * A message of a channel, followed to its definition: its name in the
 * channel, the pointer to its payload schema, and whether it's binary.
 */
function messageOf(content, channelName, ref) {
  const name = lastSegment(ref);
  let message = local(content, ref);
  let pointer = String(ref).slice(1);
  if (message?.$ref) {
    pointer = String(message.$ref).slice(1);
    message = local(content, message.$ref);
  }
  const contentType = message?.contentType ?? content?.defaultContentType;
  return { name, channel: channelName, payload: `${pointer}/payload`, binary: contentType === 'application/octet-stream' };
}

/** A server on localhost: the mock's, as an OpenAPI contract's localhost server is. */
const isLocal = (server) => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(server?.host ?? ''));

/**
 * Where the mock serves each channel of a document reached over its own
 * connection: its localhost server's `pathname`, then the channel's
 * `address`, as the mock serves an OpenAPI document's paths under its
 * localhost server's. A channel that lists servers without that one isn't
 * served.
 *
 * @param {object} content - An AsyncAPI document
 * @returns {Map<string, string> | null} channel name → path; null for a
 *   document with no localhost server, which the mock doesn't serve
 */
export function socketPaths(content) {
  const [localKey, server] = Object.entries(content?.servers ?? {}).find(([, s]) => isLocal(s)) ?? [];
  if (!server) return null;
  const base = String(server.pathname ?? '').replace(/\/$/, '');
  const paths = new Map();
  for (const [name, channel] of Object.entries(content?.channels ?? {})) {
    const listed = channel?.servers ?? [];
    if (listed.length > 0 && !listed.some((s) => lastSegment(s?.$ref) === localKey)) continue;
    const address = channel?.address ? `/${String(channel.address).replace(/^\//, '')}` : '';
    paths.set(name, `${base}${address}` || '/');
  }
  return paths;
}

/**
 * Each operation of a document: its action, its channel, the messages it
 * carries and, where it declares a `reply`, the messages that answer it.
 *
 * @param {object} content - An AsyncAPI document
 * @returns {Map<string, { action: string, channel: string, messages: object[], reply: object[] }>}
 */
export function operationsOf(content) {
  const operations = new Map();
  for (const [key, operation] of Object.entries(content?.operations ?? {})) {
    const channel = lastSegment(operation?.channel?.$ref);
    operations.set(key, {
      action: operation.action,
      channel,
      messages: (operation.messages ?? []).map((m) => messageOf(content, channel, m.$ref)),
      reply: (operation.reply?.messages ?? []).map((m) => messageOf(content, lastSegment(operation.reply.channel?.$ref) || channel, m.$ref)),
    });
  }
  return operations;
}

/** Whether a frame is binary: an ArrayBuffer, a typed array or a Blob, not text. */
export const isBinary = (data) => typeof data !== 'string';

/**
 * A checker of messages against a contract set's AsyncAPI documents.
 *
 * @param {import('@codeforamerica/blueprint-core').Doc[]} docs
 * @returns {(relativePath: string, message: object, data: unknown) => string|null}
 *   the reason `data` isn't `message`, or null when it is. Text frames are
 *   read as JSON.
 */
export function messageChecker(docs) {
  let ajv = null;
  return (relativePath, message, data) => {
    if (message.binary) return isBinary(data) ? null : `${message.name} is a binary frame`;
    if (isBinary(data)) return `${message.name} is a text frame, not binary`;
    let payload;
    try { payload = typeof data === 'string' ? JSON.parse(data) : data; } catch { return `${message.name} is JSON, and this isn't`; }
    if (!ajv) { ajv = createAjv(); registerDocuments(ajv, docs); }
    const validate = validatorFor(ajv, relativePath, message.payload);
    if (!validate) return `${message.name}'s schema, ${message.payload} in ${relativePath}, doesn't resolve`;
    if (validate(payload)) return null;
    return `not ${message.name}: ${validate.errors.map((e) => `${e.instancePath || 'the message'} ${e.message}`).join('; ')}`;
  };
}

/**
 * Which of several messages a frame is: the first it fits, with the reasons
 * it fit none when it fits none.
 *
 * @returns {{ message: object|null, reasons: string[] }}
 */
export function recognize(check, relativePath, messages, data) {
  const reasons = [];
  for (const message of messages) {
    const reason = check(relativePath, message, data);
    if (!reason) return { message, reasons };
    reasons.push(reason);
  }
  return { message: null, reasons };
}

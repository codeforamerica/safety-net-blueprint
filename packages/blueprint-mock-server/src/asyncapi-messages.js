/**
 * The messages an AsyncAPI document's operations carry: for each operation,
 * its action, its channel, and its messages, each followed to its
 * definition. A message whose `contentType` is `application/octet-stream` is
 * binary.
 */

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

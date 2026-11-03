/**
 * What identifies a suggestion, for refusing the same one proposed again.
 *
 * An operation suggestion is its call — operation, path and query parameters,
 * and body — with the ids of records a patch creates in order; an informing one its subject,
 * the field within it, and its category — or, with no category, its message
 * (decision-support.md, Decision 7). The values are normalized — trimmed,
 * runs of spaces made one, case-folded, date-times made canonical, keys and
 * parameters in a fixed order — and hashed with HMAC-SHA-256, keyed with a
 * secret, so the personal values in them can't be read back or guessed.
 *
 * The secret is `MOCK_FINGERPRINT_SECRET` where the mock runs in Node and it
 * is set; otherwise one is generated when the mock starts, as it always is in
 * a page. A fingerprint means something only to the mock that made it.
 */

// The statuses a matching proposal is refused for: still open, or turned down.
const BLOCKING = new Set(['proposed', 'refused', 'dismissed']);

const DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

let key = null;

/** The HMAC key, made once from the configured secret or random bytes. */
function hmacKey() {
  if (!key) {
    const secret = globalThis.process?.env?.MOCK_FINGERPRINT_SECRET;
    const raw = secret ? new TextEncoder().encode(secret) : crypto.getRandomValues(new Uint8Array(32));
    key = crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  }
  return key;
}

/**
 * Whether an API's create makes suggestions: the `suggestions` capability's
 * Suggestion resource.
 *
 * @param {Object} apiMetadata
 * @param {Object} endpoint
 * @returns {boolean}
 */
export function makesSuggestions(apiMetadata, endpoint) {
  return apiMetadata.doc?.content?.info?.['x-capability'] === 'suggestions'
    && endpoint.resource?.name === 'Suggestion';
}

/** A value as it is compared: two that differ only in case or spacing are the same. */
function normalized(value) {
  if (typeof value === 'string') {
    const text = value.trim().replace(/\s+/g, ' ');
    if (DATE_TIME.test(text)) {
      const time = new Date(text);
      if (!Number.isNaN(time.getTime())) return time.toISOString();
    }
    return text.toLowerCase();
  }
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => [k, normalized(value[k])]));
  }
  return value;
}

/**
 * A patch with the ids of the records it creates replaced by their order of
 * appearance, wherever it names them — in a path or a value — so the same new
 * record proposed again under a freshly chosen id reads the same.
 */
function withCreatedIdsInOrder(patch, created) {
  if (!Array.isArray(patch) || created.size === 0) return patch;
  const order = new Map();
  const ordinal = (id) => {
    if (!order.has(id)) order.set(id, `new-${order.size + 1}`);
    return order.get(id);
  };
  const swap = (value) => {
    if (typeof value === 'string') return created.has(value) ? ordinal(value) : value;
    if (Array.isArray(value)) return value.map(swap);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, swap(v)]));
    return value;
  };
  return patch.map((change) => Object.fromEntries(Object.entries(change).map(([k, v]) => [k,
    k === 'path' || k === 'from'
      ? v.split('/').map((part) => (created.has(part) ? ordinal(part) : part)).join('/')
      : swap(v)])));
}

/** The values that identify a suggestion, by its kind. */
function identityOf(suggestion, created) {
  if (suggestion.kind === 'operation') {
    const { operationId, parameters = [], requestBody } = suggestion.call ?? {};
    // Headers and cookies are about how a request is sent, not what it changes.
    // Parameters in a fixed order, so the same arguments listed differently match.
    const ordered = parameters.filter((p) => p.in === 'path' || p.in === 'query').sort((a, b) =>
      `${a.in}\u0000${a.name}`.localeCompare(`${b.in}\u0000${b.name}`));
    return { kind: 'operation', call: { operationId, parameters: ordered, payload: withCreatedIdsInOrder(requestBody?.payload, created) } };
  }
  const { subjectType, subjectId, path = '', category, message } = suggestion;
  return category
    ? { kind: 'informing', subjectType, subjectId, path, category }
    : { kind: 'informing', subjectType, subjectId, path, message };
}

/**
 * A suggestion's fingerprint: a keyed hash of what identifies it, as hex.
 *
 * @param {Object} suggestion - As proposed
 * @param {Object} [options]
 * @param {Set<string>} [options.created] - Ids of records a patch it carries creates
 * @returns {Promise<string>}
 */
export async function fingerprintOf(suggestion, { created = new Set() } = {}) {
  const text = JSON.stringify(normalized(identityOf(suggestion, created)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(), new TextEncoder().encode(text));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The suggestion a proposal with this fingerprint repeats: one still open, or
 * dismissed. An accepted or expired one doesn't count — the same thing can be
 * suggested again.
 *
 * @param {Object} store
 * @param {string} collection
 * @param {string} fingerprint
 * @returns {Object|null}
 */
export function repeated(store, collection, fingerprint) {
  const { items } = store.findAll(collection, { fingerprint }, { limit: null });
  return items.find((s) => BLOCKING.has(s.status)) ?? null;
}

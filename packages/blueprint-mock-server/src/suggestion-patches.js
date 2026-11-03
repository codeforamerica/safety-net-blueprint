/**
 * Checking a proposed suggestion whose call is a JSON Patch to an editable
 * composition, as createSuggestion's description sets out.
 *
 * The patch is applied, in memory, to the composition as it is now, and
 * planned into the calls it would become, the way the composition's own PATCH
 * plans it; nothing is saved. It's refused with 422 when a `replace`, or a
 * `remove` of a field, doesn't come right after a `test` of the same path;
 * when it names a record that neither exists nor is created earlier in the
 * patch; when a record it creates or changes doesn't fit its operation's
 * request schema; or when an evidence entry's `path` is no change's path. A
 * failed `test` is 409: the data changed after the proposer read it. Each
 * record's own operation isn't run until the suggestion is accepted.
 */

import { previewPatch } from './editable-composition.js';
import { missingReferences } from './references.js';
import { callProblems } from './operation-calls.js';

const PATCH = 'application/json-patch+json';

/** Whether a call's body is a JSON Patch. */
export function isPatchCall(call) {
  return call?.requestBody?.contentType === PATCH;
}

/** The value at a JSON Pointer, or undefined. */
function at(document, pointer) {
  return pointer.split('/').slice(1)
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), document);
}

/** A record: an object with an id, as the composition shows each one. */
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && 'id' in value;

const refuse = (status, message, details) => ({
  refused: { status, body: { code: status === 409 ? 'CONFLICT' : 'VALIDATION_ERROR', message, details } },
});

/**
 * Check a proposed suggestion. Anything other than an operation suggestion
 * whose call is a patch passes, except that only a patch's evidence may name
 * a change.
 *
 * @param {object} suggestion - As proposed
 * @param {Map} operations - From operationsOf
 * @returns {Promise<{ refused?: { status: number, body: object }, created: Set<string> }>}
 *   `created`: the ids of records the patch creates, for its fingerprint
 */
export async function checkProposedPatch(suggestion, operations = new Map()) {
  const created = new Set();
  const call = suggestion?.kind === 'operation' ? suggestion.call : null;
  const cited = (suggestion?.evidence ?? []).map((entry, i) => ({ entry, i })).filter(({ entry }) => entry.path !== undefined);

  if (!isPatchCall(call)) {
    if (cited.length > 0) {
      return { ...refuse(422, 'An evidence path names a change in a patch, and this suggestion carries no patch.',
        cited.map(({ i }) => ({ field: `evidence[${i}].path`, message: 'only for a suggestion whose call is a JSON Patch' }))), created };
    }
    return { created };
  }

  const patch = call.requestBody.payload;
  const field = (i, rest = '') => `call.requestBody.payload[${i}]${rest}`;
  const params = Object.fromEntries((call.parameters ?? []).filter((p) => p.in === 'path').map((p) => [p.name, p.value]));
  const preview = await previewPatch(call.operationId, params, patch);
  if (!preview) return { created };
  if (preview.refused) {
    const { status, body } = preview.refused;
    const details = (body.details ?? []).map(({ index, ...rest }) => (index === undefined ? rest : { ...rest, field: field(index) }));
    return { refused: { status, body: { ...body, details } }, created };
  }

  // Each replace, and each remove of a field, right after a test of its path.
  const untested = patch.map((change, i) => ({ change, i })).filter(({ change, i }) => {
    const guarded = change.op === 'replace' || (change.op === 'remove' && !isRecord(at(preview.before, change.path)));
    if (!guarded) return false;
    const previous = patch[i - 1];
    return !(previous?.op === 'test' && previous.path === change.path);
  });
  if (untested.length > 0) {
    return { ...refuse(422, 'Each replace, and each remove of a field, must come right after a test of the same path with the value that was read.',
      untested.map(({ change, i }) => ({ field: field(i), message: `${change.op} ${change.path} has no test before it` }))), created };
  }

  // Each change, as the ordinary call it becomes, fits its operation, checked
  // the way any suggestion's call is. The operation itself isn't run.
  const changeAt = (step) => Math.max(patch.findIndex((change) => change.path === step.path || change.path.startsWith(`${step.path}/`)), 0);
  const unfit = preview.steps.flatMap((step) => callProblems({ field: '', call: step.call }, operations)
    .map((problem) => ({ field: field(changeAt(step)), message: `${step.call.operationId}: ${problem.field} ${problem.message}` })));
  if (unfit.length > 0) {
    return { ...refuse(422, "A change doesn't fit what its record's operation accepts.", unfit), created };
  }

  // Every record a new or changed record names exists, or is created earlier
  // in the patch.
  const madeHere = new Map();
  for (const step of preview.steps.filter((s) => s.kind === 'create')) {
    created.add(step.body.id);
    madeHere.set(step.body.id, step.body);
  }
  // Records the patch creates count as existing, as they will when it runs.
  const store = { findById: (collection, id) => preview.store.findById(collection, id) ?? madeHere.get(id) ?? null };
  const missing = [];
  for (const step of preview.steps.filter((s) => s.kind !== 'remove')) {
    const schema = step.operation.requestSchema;
    if (!schema) continue;
    for (const problem of missingReferences(step.body, schema, step.operation.follow, store)) {
      missing.push({ field: field(changeAt(step)), message: problem.message });
    }
  }
  if (missing.length > 0) {
    return { ...refuse(422, 'The patch names a record that neither exists nor is created earlier in it.', missing), created };
  }

  // An evidence entry's path is one of the changes'.
  const changed = new Set(patch.filter((change) => change.op !== 'test').map((change) => change.path));
  const stray = cited.filter(({ entry }) => !changed.has(entry.path));
  if (stray.length > 0) {
    return { ...refuse(422, 'An evidence path names no change in the patch.',
      stray.map(({ entry, i }) => ({ field: `evidence[${i}].path`, message: `no change in the patch has the path ${entry.path}` }))), created };
  }
  return { created };
}

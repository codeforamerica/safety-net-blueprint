/**
 * A `Doc` — what a contract document is, once it has been parsed.
 *
 * `load` reads a file and produces one of these. The building is separate from
 * the reading because a browser has the second half of the problem without the
 * first: `extract(artifact, 'docs')` is handed documents that were parsed in
 * Node and serialized, and has to rebuild the same objects without touching a
 * filesystem (#448).
 *
 * A Doc carries four methods, and that is the reason this module has to exist.
 * JSON cannot hold a method, so a document read back from an artifact would be
 * data only — and `extract(docs, 'relationships')` calls `model()`, while
 * `generate(docs, 'postman')` calls `refs()` and `resolveRef()`. Rebuilding
 * them means the two paths hold the same type, instead of a page working right
 * up until it reaches one of those.
 *
 * Deliberately free of Node imports, like `ref-lookup.js`, and for the same
 * reason: an `fs` import here would put the filesystem back into `extract`'s
 * module graph, which the browser entry's guard test exists to catch.
 */

import { followRef, indexByRelativePath, resolveRef, isRemoteRef } from './ref-lookup.js';

/**
 * Build a Doc from already-parsed document data.
 *
 * @param {object} fields
 * @param {string} fields.path - Where the document came from
 * @param {string|null} [fields.relativePath] - Its path within the contract set
 * @param {string|null} [fields.domain] - Falls back to what the content declares
 * @param {string} fields.type - From `detectType`
 * @param {*} fields.content - The parsed document
 * @param {object|null} [fields.provenance] - Resolve manifest, when one governs it
 * @returns {import('../types.js').Doc}
 */
export function toDoc({ path, relativePath = null, domain = null, type, content, provenance = null }) {
  return {
    path,
    relativePath,
    // discover() resolves this against the whole set, which is the only way
    // the path-segment and filename fallbacks can work. Loading a file alone
    // still gets the two answers the content itself provides.
    domain: domain ?? content?.info?.['x-domain'] ?? content?.domain ?? null,
    type,
    content,
    refs() { return indexRefs(this.content); },
    externalRefs(docs) { return externalRefs(this, docs); },
    resolveRef(ref, docs) { return resolveRef(ref, docs, this.relativePath); },
    model() { return buildModel(this.type, this.content); },
    resolved: provenance !== null,
    provenance,
  };
}

/**
 * The sibling documents this document's external $refs point at.
 *
 * Keyed by the ref's file part exactly as written, since that is what a
 * caller has in hand when it meets the ref. Canonical https:// refs are
 * skipped — they are rewritten to relative paths at write time, and before
 * that they resolve through the schema registry, not the file tree.
 *
 * Resolves against the set's relative paths rather than by joining absolute
 * paths and normalizing them, which is what this did while it lived in
 * `load.js`. That was the third hand-rolled ref resolver in the package —
 * `ref-lookup.js` was written to replace the other two and this one was
 * missed. Going through `followRef` makes it portable, since a page has
 * documents but no directories to do path arithmetic on, and picks up the
 * candidate forms a ref can take: sibling, bare, and parent-relative.
 *
 * @param {import('../types.js').Doc} doc
 * @param {import('../types.js').Doc[]} docs - The set to resolve against
 * @returns {Map<string, object>} Ref file part to that document's content
 */
function externalRefs(doc, docs) {
  const byRelativePath = indexByRelativePath(docs);
  const found = new Map();

  for (const ref of doc.refs().values()) {
    if (!ref.external || !ref.file) continue;
    // Canonical refs resolve through the schema registry, not the file tree.
    if (isRemoteRef(ref.file)) continue;

    // A ref with no fragment names a whole document, which `followRef`
    // returns as the node — an empty JSON pointer addresses the root.
    const target = followRef(ref.file, byRelativePath, doc.relativePath);
    if (target) found.set(ref.file, target.content);
  }

  return found;
}

/**
 * Index every $ref in a document.
 *
 * Local refs resolve to the object they point at. External refs are recorded
 * with their file and fragment but left unresolved — resolving them needs the
 * sibling documents, which `load` deliberately does not read.
 *
 * @param {*} content - Parsed document
 * @returns {Map<string, { pointer: string, external: boolean, file: string|null, target: * }>}
 */
function indexRefs(content) {
  const refs = new Map();

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        const hashIdx = value.indexOf('#');
        const file = hashIdx === 0 ? null : value.slice(0, hashIdx === -1 ? value.length : hashIdx);
        const pointer = hashIdx === -1 ? '' : value.slice(hashIdx + 1);
        const external = file !== null;
        // `resolved` is tracked separately from `target` because a pointer can
        // legitimately address a null node. Collapsing the two would report a
        // valid reference as broken.
        const found = external ? undefined : resolvePointer(content, pointer);
        refs.set(value, {
          pointer,
          external,
          file,
          // The last fragment segment, which is the schema name across every
          // ref form: #/components/schemas/Foo, #/$defs/Foo, and external
          // refs ending in either.
          name: pointer.split('/').filter(Boolean).pop() ?? null,
          resolved: external ? null : found !== undefined,
          target: found ?? null,
        });
      }
      walk(value);
    }
  }

  walk(content);
  return refs;
}

/**
 * Follow a JSON Pointer within a document.
 *
 * @param {*} root - Document to walk
 * @param {string} pointer - Fragment, e.g. '/components/schemas/Application'
 * @returns {*} The referenced value, or undefined if the path does not exist
 */
function resolvePointer(root, pointer) {
  if (!pointer) return root;

  let node = root;
  for (const rawSegment of pointer.split('/').filter(Boolean)) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === null || typeof node !== 'object') return undefined;
    node = node[segment];
  }
  return node;
}

/**
 * Build the normalized view for blueprint-authored contract types.
 *
 * Only state machines are normalized today. Rules and compositions get a model
 * when something needs to walk them — adding one is additive, since every Doc
 * already carries the field.
 *
 * @param {string} type - Contract type from detectType
 * @param {*} content - Parsed document
 * @returns {*|null} Normalized view, or null for standards-defined types
 */
function buildModel(type, content) {
  if (type !== 'state-machine') return null;
  if (!content || typeof content !== 'object') return null;

  // A base state machine (one others `extend`) carries shared procedures at the
  // top level and declares no machines of its own. Both shapes are normalized,
  // so `model` is non-null for every blueprint-authored document.
  return {
    machines: (content.machines ?? []).map((machine) => ({
      ...machine,
      actions: normalizeStepHolders(machine.actions),
      events: normalizeStepHolders(machine.events),
      procedures: normalizeStepHolders(machine.procedures),
    })),
    procedures: normalizeStepHolders(content.procedures),
  };
}

/**
 * Normalize the steps of every entry in an action, event, or procedure list.
 *
 * All three carry a `steps` array; only their surrounding fields differ, so
 * those are passed through untouched.
 *
 * @param {object[]} holders - Entries from machine.actions/events/procedures
 * @returns {object[]}
 */
function normalizeStepHolders(holders) {
  if (!Array.isArray(holders)) return [];
  return holders.map((holder) => ({ ...holder, steps: normalizeSteps(holder.steps) }));
}

/**
 * Convert the step list of an action into uniform nodes.
 *
 * The authored format nests bodies under a different key per step kind —
 * `then`/`else` on if, `when` on match, `do` on forEach — and puts
 * `description` inside the body for set/emit but beside it for the branching
 * kinds. Normalizing gives every step `{ kind, ...fields, children }`, so a
 * caller walks the tree with plain recursion instead of a helper per kind.
 *
 * It also collapses the one dual shape in the authored format: `call` is
 * either a procedure name or an HTTP request object. The model always reports
 * both `procedure` and `request`, one of them null.
 *
 * @param {object[]} steps - Authored steps from content
 * @returns {{ kind: string, children: object[] }[]}
 */
function normalizeSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.map(normalizeStep);
}

/**
 * @param {object} step - One authored step
 * @returns {{ kind: string, children: object[] }}
 */
function normalizeStep(step) {
  if ('if' in step) {
    return {
      kind: 'if',
      condition: step.if,
      description: step.description,
      children: [
        { kind: 'then', children: normalizeSteps(step.then) },
        ...(step.else ? [{ kind: 'else', children: normalizeSteps(step.else) }] : []),
      ],
    };
  }

  if ('match' in step) {
    return {
      kind: 'match',
      on: step.match,
      description: step.description,
      children: Object.entries(step.when ?? {}).map(([value, branchSteps]) => ({
        kind: 'case',
        value,
        children: normalizeSteps(branchSteps),
      })),
    };
  }

  if ('forEach' in step) {
    return {
      kind: 'forEach',
      ...step.forEach,
      description: step.description,
      children: normalizeSteps(step.do),
    };
  }

  if ('call' in step) {
    const isProcedure = typeof step.call === 'string';
    return {
      kind: 'call',
      procedure: isProcedure ? step.call : null,
      request: isProcedure ? null : step.call,
      description: step.description,
      children: [],
    };
  }

  // set and emit carry their own description inside the body, so spread last.
  const kind = Object.keys(step)[0] ?? 'unknown';
  const body = step[kind];
  return {
    kind,
    ...(body && typeof body === 'object' && !Array.isArray(body) ? body : {}),
    children: [],
  };
}

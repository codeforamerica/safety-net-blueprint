/**
 * Parse one contract file into a Doc.
 *
 * A Doc keeps the parsed document in its native shape under `content` — what
 * was read is what gets written back. Two derived views hang off it, both
 * methods rather than fields:
 *
 *   refs()   an index of every $ref in the document
 *   model()  a normalized view of blueprint-authored types, null otherwise
 *
 * They are computed from `this.content` on every call, which is what makes
 * them safe. A resolve pass produces its next document with `{...doc, content}`,
 * and spread copies these methods but not any value they had already produced
 * — so the derived view always reflects the content it is asked about. Stored
 * as fields they went stale the moment a pass rewrote `content`, and validate
 * silently checked pre-resolution documents.
 *
 * For the same reason these must stay object-literal methods. Spread copies
 * own enumerable properties only, so a class prototype method would vanish on
 * the first pass, and an arrow closing over `content` would capture the value
 * at load time and never update.
 *
 * Standards-defined documents (OpenAPI, AsyncAPI, JSON Schema) are left in
 * their standard shape — every downstream tool already speaks it, and a
 * parallel representation would only need converting back.
 */

import { readFileSync, existsSync } from 'fs';
import { basename, dirname, join, resolve as resolvePath, parse as parsePath } from 'path';
import yaml from 'js-yaml';
import { detectType } from './openapi/contract-files.js';

export const MANIFEST_FILENAME = '.blueprint-resolved.json';

/**
 * Read a contract file and build its Doc.
 *
 * Takes what `discover` returned rather than its parts: `path`, `relativePath`
 * and `domain` are one thing — the file's identity within the set — so
 * `discover(dir).map(load)` carries all of it through. A bare path is accepted
 * for a file that belongs to no set; `relativePath` is then null, and
 * `generate` rejects such a document rather than guessing at a root.
 *
 * @param {import('../types.js').DiscoveredFile|string} file - What `discover`
 *   returned, or a bare path for a file that belongs to no set
 * @returns {import('../types.js').Doc}
 */
export function load(file) {
  const { path, relativePath = null, domain = null } =
    typeof file === 'string' ? { path: file } : file;

  const raw = readFileSync(path, 'utf8');
  const content = yaml.load(raw, { schema: yaml.CORE_SCHEMA });
  const type = detectType(basename(path), content);
  const provenance = readManifest(path);

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
    resolveRef(ref, docs) { return resolveRef(ref, docs); },
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
 * @param {import('../types.js').Doc} doc
 * @param {import('../types.js').Doc[]} docs - The set to resolve against
 * @returns {Map<string, object>} Ref file part to that document's content
 */
function externalRefs(doc, docs) {
  const byPath = new Map(docs.map((d) => [resolvePath(d.path), d.content]));
  const dir = dirname(resolvePath(doc.path));
  const found = new Map();

  for (const ref of doc.refs().values()) {
    if (!ref.external || !ref.file) continue;
    if (ref.file.startsWith('http://') || ref.file.startsWith('https://')) continue;

    const content = byPath.get(resolvePath(dir, ref.file));
    if (content) found.set(ref.file, content);
  }

  return found;
}

/**
 * Follow one external $ref to the schema it names.
 *
 * The file part is matched against relative paths within the set. A ref
 * written from a subdirectory may lead with `../` segments that the set's
 * own paths do not have, so those are stripped and retried.
 *
 * @param {string} ref - An external $ref, e.g. `../schemas/intake.yaml#/$defs/Member`
 * @param {import('../types.js').Doc[]} docs
 * @returns {object} The referenced schema, or an empty object if unresolvable
 */
function resolveRef(ref, docs) {
  const hashIdx = ref.indexOf('#');
  if (hashIdx === -1) return {};

  const anchor = ref.slice(hashIdx + 1);
  const wanted = ref.slice(0, hashIdx).replace(/^\.\//, '');

  const byRelative = new Map(docs.map((d) => [d.relativePath, d.content]));
  const content =
    byRelative.get(wanted) ?? byRelative.get(wanted.replace(/^(\.\.\/)+/, ''));
  if (!content) return {};

  let node = content;
  for (const segment of anchor.split('/').filter(Boolean)) {
    if (node === null || typeof node !== 'object') return {};
    node = node[segment];
  }
  return node ?? {};
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

/**
 * Find the resolve manifest governing a file.
 *
 * Walks up from the file's directory. A resolved contract sits inside the
 * output directory resolve wrote, so the manifest is at or above it. A file
 * copied away from that directory has no manifest and is reported unresolved —
 * which is correct, since its provenance genuinely is unknown.
 *
 * @param {string} filePath - Absolute path to the contract file
 * @returns {object|null} Manifest contents, or null if none governs this file
 */
function readManifest(filePath) {
  let dir = dirname(filePath);
  const { root } = parsePath(dir);

  while (true) {
    const candidate = join(dir, MANIFEST_FILENAME);
    if (existsSync(candidate)) {
      try {
        return JSON.parse(readFileSync(candidate, 'utf8'));
      } catch {
        return null;
      }
    }
    if (dir === root) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

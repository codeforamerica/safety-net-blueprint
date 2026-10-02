/**
 * Following a `$ref` across files, within a set already in memory.
 *
 * Two places needed this and had grown their own: `load.js` matched the ref's
 * file part against the set's relative paths, while `json-schema/paths.js`
 * joined it onto the referring file's directory and read the result off disk.
 * The second is why `resolveSchemaRefs` — and therefore `extract`, `validate`
 * and `generate` — could not run anywhere without a filesystem.
 *
 * Resolving against the set rather than the disk also makes the boundary
 * structural instead of arithmetic. `paths.js` used to bound ref following to
 * the contract set by computing the referring file's package root and
 * rejecting any target whose relative path escaped it. A document that is not
 * in the set now simply cannot be found, so the bound holds without being
 * calculated — the same reason the store contract is enforced by a module
 * graph rather than by review.
 *
 * Deliberately free of Node imports: this module is the reason the three
 * public functions above are portable, so an `fs` import here would undo it.
 */

/**
 * Split a `$ref` into the file it names and the pointer within that file.
 *
 * @param {string} ref - e.g. `../schemas/intake.yaml#/$defs/Member`
 * @returns {{ file: string, pointer: string }} `file` is '' for a same-document
 *   ref; `pointer` is '' for a whole-document ref
 */
export function splitRef(ref) {
  const hashIdx = ref.indexOf('#');
  return hashIdx === -1
    ? { file: ref, pointer: '' }
    : { file: ref.slice(0, hashIdx), pointer: ref.slice(hashIdx + 1) };
}

/**
 * A ref's file part as a path within the set, resolved against the directory
 * of the document holding it.
 *
 * `./shared.yaml` from `domains/intake/intake-openapi.yaml` is
 * `domains/intake/shared.yaml`, and `../../base/components/responses.yaml`
 * from the same file is `base/components/responses.yaml`.
 *
 * @param {string} file - The ref's file part
 * @param {string|null} [fromPath] - relativePath of the referring document
 * @returns {string}
 */
export function normalizeRefPath(file, fromPath = null) {
  const wanted = file.replace(/^\.\//, '');
  if (!fromPath?.includes('/')) return wanted;

  const fromDir = fromPath.slice(0, fromPath.lastIndexOf('/') + 1);
  return (fromDir + wanted)
    .split('/')
    .reduce((parts, part) => {
      if (part === '..') parts.pop();
      else if (part !== '.') parts.push(part);
      return parts;
    }, [])
    .join('/');
}

/**
 * Whether a ref's file part names something outside the file tree.
 *
 * Canonical `https://blueprint.codeforamerica.org/...` refs resolve through
 * the schema registry against the directories core ships, not by matching a
 * path within the set — so a check that a ref names a document in the set
 * must skip them or every one would look broken.
 *
 * @param {string} file - A ref's file part
 * @returns {boolean}
 */
export function isRemoteRef(file) {
  return typeof file === 'string' && (file.startsWith('http://') || file.startsWith('https://'));
}

/**
 * Walk a JSON pointer into a document.
 *
 * @param {*} content - Parsed document
 * @param {string} pointer - e.g. `/components/schemas/Case`, or '' for the root
 * @returns {*} The node, or undefined when any segment is missing
 */
export function pointerInto(content, pointer) {
  let node = content;
  for (const segment of pointer.split('/').filter(Boolean)) {
    if (node === null || typeof node !== 'object') return undefined;
    node = node[segment];
  }
  return node;
}

/**
 * Index a set of documents by the relative path a `$ref` would name them with.
 *
 * Accepts both shapes the callers already hold: a `Doc` carries its document
 * under `content`, while `validate` and `compositions` pass `{ relativePath,
 * spec }`. Taking either avoids making every caller reshape its set first.
 *
 * @param {Array<{ relativePath?: string|null, path?: string, content?: *, spec?: * }>} entries
 * @returns {Map<string, *>} relativePath to that document's content
 */
export function indexByRelativePath(entries) {
  const index = new Map();
  for (const entry of entries) {
    const key = entry.relativePath ?? entry.path;
    if (!key) continue;
    const content = entry.content ?? entry.spec;
    // First wins: a set should not hold two documents at one relative path,
    // and if it does, overwriting would make the result order-dependent.
    if (content !== undefined && !index.has(key)) index.set(key, content);
  }
  return index;
}

/**
 * Follow a `$ref` to the document and node it names.
 *
 * Returns the owning document alongside the node, because resolution
 * continues inside that document: a ref followed into another file changes
 * which file subsequent relative refs are written against.
 *
 * @param {string} ref
 * @param {Map<string, *>} byRelativePath - From `indexByRelativePath`
 * @param {string|null} [fromPath] - relativePath of the referring document
 * @returns {{ node: *, content: *, relativePath: string }|null} Null when the
 *   ref names no document in the set, or no node within it
 */
export function followRef(ref, byRelativePath, fromPath = null) {
  const { file, pointer } = splitRef(ref);
  if (!file) return null;

  const wanted = file.replace(/^\.\//, '');
  const joined = normalizeRefPath(file, fromPath);

  // The joined form is the correct one; the other two are fallbacks for a
  // caller that gave no fromPath, which load() permits for a lone document.
  const candidates = [joined, wanted, wanted.replace(/^(\.\.\/)+/, '')];

  // First document match wins, and a missing node within it is a miss rather
  // than a reason to try the next candidate. Both callers behaved this way
  // before sharing this code, and "try the next file" would let a ref resolve
  // against a document it does not name.
  const relativePath = candidates.find((c) => byRelativePath.has(c));
  if (relativePath === undefined) return null;

  const content = byRelativePath.get(relativePath);
  const node = pointerInto(content, pointer);
  return node === undefined ? null : { node, content, relativePath };
}

/**
 * Follow one external $ref to the schema it names.
 *
 * The file part is matched against relative paths within the set. A ref
 * written from a subdirectory may lead with `../` segments that the set's
 * own paths do not have, so those are stripped and retried.
 *
 * Returns `{}` rather than null for an unresolvable ref: callers spread the
 * result into a schema, and a missing external ref means "nothing to add".
 *
 * Lived in `load.js` as a wrapper over the two functions above, which left
 * `generate` importing the filesystem to reach five lines that never touch it.
 *
 * @param {string} ref - An external $ref, e.g. `../schemas/intake.yaml#/$defs/Member`
 * @param {import('../types.js').Doc[]} docs
 * @param {string} [fromPath] - relativePath of the document holding the ref,
 *   so a relative ref resolves against its own directory
 * @returns {object} The referenced schema, or an empty object if unresolvable
 */
export function resolveRef(ref, docs, fromPath = null) {
  if (!ref.includes('#')) return {};
  const found = followRef(ref, indexByRelativePath(docs), fromPath);
  return found?.node ?? {};
}

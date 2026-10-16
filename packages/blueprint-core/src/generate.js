/**
 * Generate an artifact from a contract set.
 *
 * `discover`, `load`, `resolve` and `validate` act on contracts. `generate`
 * produces something else *from* them, and the second argument says what:
 *
 *   overlay   OpenAPI Overlays that add the endpoints and schemas a
 *             composition, ruleset or state machine action implies
 *   graph     compiled decision graphs, one per ruleset
 *   events-asyncapi  an AsyncAPI document beside each OpenAPI document, of the
 *             events its resources and their state machines send
 *   postman   a Postman collection exercising every endpoint
 *   artifact  the whole contract set as one serializable object
 *
 * Every one of these produces content the inputs do not contain. `examples`
 * used to be here and is now `extract(docs, 'examples')`: grouping records the
 * documents already declare is a readout, not a derivation, and having one
 * case that contradicted the distinction made the distinction useless.
 *
 * `artifact` is what a browser boots from — a contract set that was discovered
 * and loaded in Node, reduced to data that survives JSON, which
 * `extract(artifact, 'docs')` reads back (#448).
 *
 * Takes the whole document set because an overlay targets a sibling spec by
 * relative path, and rules compile against schemas other documents declare.
 * Nothing is written here — the caller decides where artifacts go.
 */

import { generateCompositionOverlays } from './compositions.js';
import { followRef, indexByRelativePath, normalizeRefPath, splitRef } from './ref-lookup.js';
import { generateRulesResults } from './rules.js';
import { detectComponentPrefix, rewriteComponentRefs } from './generate/refs.js';
import { generateRpcOverlays } from './generate/rpc.js';
import { buildPostman } from './generate/postman.js';
import { buildEventCatalogs } from './generate/events.js';
import { buildArtifact } from './artifact.js';
import { fileNameOf } from './contract-types.js';
import { declaredResource } from './attachment.js';
import { toDoc } from './doc.js';

/** What `generate` knows how to produce. */
const BUILDERS = {
  overlay: buildOverlays,
  graph: buildGraphs,
  'rules-api': buildRulesApis,
  'events-asyncapi': (positioned) => buildEventCatalogs(positioned)
    .map(({ relativePath, content }) => toDoc({ path: relativePath, relativePath, type: 'asyncapi', content })),
  postman: buildPostman,
  artifact: buildArtifact,
};

/**
 * @param {import('../types.js').Doc[]} docs
 * @param {'overlay'|'graph'|'rules-api'|'events-asyncapi'|'postman'|'artifact'} type - Which artifact to build
 * @param {object} [options] - Passed to the builder that needs them
 * @returns {*} Whatever that artifact is
 */
export function generate(docs, type, options) {
  const builder = BUILDERS[type];
  if (!builder) {
    throw new Error(
      `generate: unknown artifact type "${type}". Known types: ${Object.keys(BUILDERS).join(', ')}.`
    );
  }

  const positioned = docs.filter((doc) => doc.relativePath !== null);
  assertPositioned(docs, positioned);

  return builder(positioned, options);
}

/**
 * Overlays ready for `resolve` to apply.
 *
 * The `domain` each generator reports is how its target spec is found, so
 * refs can be aligned to that spec's convention. Once that is done the
 * pairing has served its purpose and resolve just applies documents.
 *
 * @param {import('../types.js').Doc[]} positioned
 * @returns {import('../types.js').Overlay[]}
 */
function buildOverlays(positioned) {

  const inputFiles = specsOf(positioned);

  // RPC overlays align their own refs, because finding the target spec is
  // part of generating them — each machine attaches to the resource it governs.
  const rpc = generateRpcOverlays(positioned).map((entry) => entry.overlay);
  const overlays = [
    ...rpc,
    ...alignRefs(compositionOverlays(positioned, inputFiles), positioned),
  ];

  refuseHandWritten(overlays, positioned);
  return overlays;
}

/**
 * The API document each rules file's endpoints are documented in, as Docs
 * positioned beside it — `intake-rules-openapi.yaml` beside `intake-rules.yaml`.
 * A caller adds them to the set it resolves, so they are validated, written
 * and served like any other OpenAPI document.
 *
 * @param {import('../types.js').Doc[]} positioned
 * @returns {import('../types.js').Doc[]}
 */
function buildRulesApis(positioned) {
  const { apis } = rulesArtifacts(positioned, specsOf(positioned));
  return [...apis].map(([relativePath, content]) => toDoc({ path: relativePath, relativePath, type: 'openapi', content }));
}

/**
 * Compiled decision graphs, with where each should be written.
 *
 * Each graph records its own `domain` and `ruleset`, so only the write
 * location is added here.
 *
 * @param {import('../types.js').Doc[]} positioned
 * @returns {{ path: string, graph: object }[]}
 */
function buildGraphs(positioned) {
  const { graphs } = rulesArtifacts(positioned, specsOf(positioned));
  return [...graphs].map(([path, graph]) => ({ path, graph }));
}

/**
 * @param {import('../types.js').Doc[]} positioned
 * @returns {{ relativePath: string, spec: object }[]}
 */
function specsOf(positioned) {
  return positioned.map((doc) => ({ relativePath: doc.relativePath, spec: doc.content }));
}

/**
 * Refuse an operation written by hand that a generated one would replace.
 *
 * A state machine's transitions and a composition's endpoints are generated
 * into the OpenAPI document that declares their resource, and setting a path
 * replaces whatever the document had there. An operation the author also wrote
 * by hand at that path would vanish from the published document without a
 * word — and either way the route would have two sources. So it is an error,
 * caught here, before the generated operation overwrites it. An operation that
 * already carries the same generated marker is one resolve wrote earlier.
 *
 * @param {object[]} overlays - Generated overlays, each action naming its target `file`
 * @param {import('../types.js').Doc[]} docs
 * @throws {Error} Naming every operation written by hand that a generated one would replace
 */
function refuseHandWritten(overlays, docs) {
  const byPath = new Map(docs.map((doc) => [doc.relativePath, doc]));
  const conflicts = [];

  for (const overlay of overlays) {
    for (const action of overlay.actions ?? []) {
      if (action.target !== '$.paths' || !action.update) continue;
      const target = byPath.get(action.file);
      if (!target) continue;

      for (const [path, generated] of Object.entries(action.update)) {
        for (const [method, operation] of Object.entries(generated ?? {})) {
          const written = target.content?.paths?.[path]?.[method];
          const source = operation?.['x-relationship'];
          if (!written || !source?.type || written['x-relationship']?.type === source.type) continue;
          conflicts.push(`${method.toUpperCase()} ${path} is written in ${target.relativePath} and also generated from ${describeSource(source)}.`);
        }
      }
    }
  }

  if (conflicts.length > 0) {
    throw new Error(
      `${conflicts.join('\n')}\nAn endpoint generated from another contract comes from that contract; remove it from the OpenAPI document.`
    );
  }
}

/** "the intake state machine's submit action", from a generated operation's marker. */
function describeSource({ type, domain, id }) {
  if (type === 'state-machine-action') return `the ${domain} state machine's "${id}" action`;
  if (type === 'composition') return `the ${domain} composition "${id}"`;
  return `${type} "${id}"`;
}

/**
 * Point each generated overlay at the document it actually patches.
 *
 * Each composition overlay carries the relative path of the
 * document it attaches to (`target`, from `declaredResource`). Overlay
 * targeting matches `file:` against that exact path, so every action naming
 * the target's filename is rewritten to it, and refs are aligned to the prefix
 * the target uses, since a generator has no idea where it sits.
 *
 * @param {{ domain: string, overlay: object, target: string|null }[]} generated
 * @param {import('../types.js').Doc[]} docs
 * @returns {object[]} Overlay documents
 */
function alignRefs(generated, docs) {
  return generated.map(({ overlay, target: targetPath }) => {
    const target = targetPath ? docs.find((doc) => doc.relativePath === targetPath) : null;
    if (!target) return overlay;

    for (const action of overlay.actions ?? []) {
      if (typeof action.file === 'string' && fileNameOf(action.file) === fileNameOf(target.relativePath)) {
        action.file = target.relativePath;
      }
    }

    return rewriteComponentRefs(overlay, './', detectComponentPrefix(target.content));
  });
}

/**
 * The relative path of the OpenAPI document a compositions document attaches
 * to: the one declaring the resource its compositions name. Null when its
 * domain declares none of them.
 *
 * @param {import('../types.js').Doc[]} docs
 * @param {import('../types.js').Doc} doc
 * @returns {string|null}
 */
function hostPath(docs, doc) {
  const collections = Object.values(doc.content.compositions ?? {}).map((c) => c?.resource).filter(Boolean);
  const declared = declaredResource(docs, doc.content.domain, collections, doc.relativePath ?? doc.path);
  return declared ? declared.api.relativePath ?? null : null;
}

/**
 * Refuse to generate from documents that do not know where they sit.
 *
 * An overlay addresses its target by relative path, so a document loaded
 * outside a contract set cannot be projected. Failing here is better than
 * emitting an overlay that silently targets nothing.
 *
 * @param {import('../types.js').Doc[]} docs
 * @param {import('../types.js').Doc[]} positioned
 */
function assertPositioned(docs, positioned) {
  if (positioned.length === docs.length) return;

  const orphans = docs
    .filter((doc) => doc.relativePath === null)
    .filter((doc) => doc.type === 'compositions' || doc.type === 'rules')
    .map((doc) => doc.path);

  if (orphans.length > 0) {
    throw new Error(
      'generate() needs each document\'s position within the contract set to address ' +
      'overlay targets, but these were loaded without one:\n  ' + orphans.join('\n  ') +
      '\nLoad them via discover(), which supplies relativePath.'
    );
  }
}

/**
 * @param {import('../types.js').Doc[]} docs
 * @param {{ relativePath: string, spec: object }[]} inputFiles
 * @returns {{ domain: string, overlay: object }[]}
 */
function compositionOverlays(docs, inputFiles) {
  const compositionFiles = docs
    .filter((doc) => doc.type === 'compositions' && doc.content?.compositions)
    .map((doc) => ({
      filePath: doc.path,
      domain: doc.content.domain,
      doc: doc.content,
      apiSpecFile: hostPath(docs, doc),
    }));

  return compositionFiles.length > 0
    ? generateCompositionOverlays(compositionFiles, inputFiles)
    : [];
}

/**
 * @param {import('../types.js').Doc[]} docs
 * @param {{ relativePath: string, spec: object }[]} inputFiles
 * @returns {{ graphs: Map<string, object>, apis: Map<string, object> }}
 */
function rulesArtifacts(docs, inputFiles) {
  const rulesFiles = docs
    .filter((doc) => doc.type === 'rules' && doc.content?.rulesets)
    .map((doc) => ({ relativePath: doc.relativePath, doc: doc.content }));

  if (rulesFiles.length === 0) return { graphs: new Map(), apis: new Map() };

  const byRelativePath = new Map(docs.map((d) => [d.relativePath, d]));

  /**
   * Follow a `$ref` in an input declaration.
   *
   * Internal refs (`#/$defs/Member`) resolve within the rules document itself;
   * external ones resolve across the contract set, which is why this lives
   * here rather than in the compiler — `generate` is the only step that sees
   * every document.
   */
  const resolve = (ref, rulesDoc) => {
    if (typeof ref !== 'string') return null;

    if (ref.startsWith('#')) {
      let node = rulesDoc;
      for (const segment of ref.slice(1).split('/').filter(Boolean)) {
        if (node === null || typeof node !== 'object') return null;
        node = node[segment];
      }
      return node ?? null;
    }

    const owner = docs.find((d) => d.content === rulesDoc);
    const found = followRef(ref, byPath, owner?.relativePath);
    // The schema is handed back with its own refs pointing where they did in
    // the document it came from: a household's `#/$defs/HouseholdMember` means
    // that file's definition, not the rules file's. Without this the compiler
    // followed the first ref and stopped at the next, so a member's fields —
    // a date of birth among them — were never declared.
    return found ? rebaseRefs(found.node, found.relativePath) : null;
  };
  const byPath = indexByRelativePath(docs);

  return generateRulesResults(rulesFiles, inputFiles, resolve);
}

/**
 * A copy of a schema whose `$ref`s name their targets by path within the set,
 * worked out from the document the schema was read from — so they still
 * resolve once the schema is read from somewhere else. Canonical https refs
 * are left alone; they resolve through the registry.
 *
 * @param {*} node
 * @param {string} fromPath - relativePath of the document `node` came from
 * @returns {*}
 */
function rebaseRefs(node, fromPath) {
  if (Array.isArray(node)) return node.map((item) => rebaseRefs(item, fromPath));
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string' && !/^https?:/.test(value)) {
      const { file, pointer } = splitRef(value);
      out[key] = `${file ? normalizeRefPath(file, fromPath) : fromPath}#${pointer ?? ''}`;
    } else {
      out[key] = rebaseRefs(value, fromPath);
    }
  }
  return out;
}

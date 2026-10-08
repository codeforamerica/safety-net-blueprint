/**
 * Reading what the server needs out of a document set.
 *
 * Three small readers, shared by the two boot paths. `setup.js` walks a
 * directory and `browser.js` takes an artifact, but once either has `docs`
 * they ask the same questions — and were each answering them with their own
 * copy of these functions, one of which carried a comment saying it was "kept
 * in step with setup.js" (#448). Keeping them in step by hand is the thing
 * that fails quietly, so they live here instead.
 *
 * Everything here is a pure read over `docs`. What belongs here rather than in
 * `blueprint-core`'s `extract` is anything phrased in the *server's*
 * vocabulary: `contractsOfType` returns the `{ filePath, domain, doc }` shape
 * the route generator wants, and the graph readers encode a decision about
 * where compilation happens. Reading a contract type is `extract`'s remit —
 * registry entries used to be here and are now `extract(docs, 'registries')`.
 */

/**
 * Documents of one contract type that carry a given section.
 *
 * @param {import('@codeforamerica/blueprint-core').Doc[]} docs
 * @param {string} type - Contract type, e.g. 'rules'
 * @param {string} section - A key the document must declare, e.g. 'rulesets'
 * @returns {{ filePath: string, domain: string, doc: object }[]}
 */
export function contractsOfType(docs, type, section) {
  return docs
    .filter((doc) => doc.type === type && doc.content?.[section])
    .map((doc) => ({ filePath: doc.path, domain: doc.content.domain, doc: doc.content }));
}


/**
 * The compiled decision graphs in the set.
 *
 * A graph is a contract type of its own, with a schema and a `-graph.yaml`
 * suffix, and `blueprint-resolve` compiles one per ruleset and writes it
 * beside the rules document. So the set already holds them, and both boot
 * paths used to recompile with `generate(docs, 'graph')` and get the identical
 * bytes back — verified byte-for-byte against the emitted documents.
 *
 * Reading them instead means one thing compiles graphs. Recompiling here could
 * also disagree with what the pipeline wrote, if the server and the resolve
 * step ran under different versions of the compiler — and the explorer and
 * harness display the written document, not this one.
 *
 * @param {import('@codeforamerica/blueprint-core').Doc[]} docs
 * @returns {object[]} Graph documents, in discovery order
 */
export function graphsOf(docs) {
  return docs.filter((doc) => doc.type === 'graph').map((doc) => doc.content);
}

/**
 * Whether a set declares rulesets but carries no compiled graph for them.
 *
 * The one case reading rather than compiling gives up: an unresolved contract
 * set. Rules without graphs means `blueprint-resolve` has not run, and the
 * rules endpoints will register but evaluate nothing. Worth saying plainly
 * rather than silently compiling on the server's behalf, which would put the
 * compiler back in two places.
 *
 * @param {{ domain: string }[]} rulesFiles - From `contractsOfType(docs, 'rules', 'rulesets')`
 * @param {object[]} graphs - From `graphsOf(docs)`
 * @returns {string|null} A message to warn with, or null when nothing is wrong
 */
export function unresolvedRulesWarning(rulesFiles, graphs) {
  if (rulesFiles.length === 0 || graphs.length > 0) return null;
  const domains = [...new Set(rulesFiles.map((r) => r.domain))].join(', ');
  return `${rulesFiles.length} rules document(s) found (${domains}) but no compiled ` +
    'graphs. Rules endpoints will register but cannot evaluate. Run ' +
    '`blueprint-resolve` over the contracts first — it compiles each ruleset ' +
    'to a *-graph.yaml beside it.';
}

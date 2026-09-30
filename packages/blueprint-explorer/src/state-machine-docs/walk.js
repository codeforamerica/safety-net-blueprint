/**
 * Walking a state machine's steps.
 *
 * `Doc.model()` normalizes the authored shape — `then`/`else` on if, `when`
 * on match, `do` on forEach — so every step is `{ kind, ...fields, children }`
 * and walking is plain recursion. These helpers name the few structural
 * questions the renderers ask of that tree, so each renderer does not
 * rediscover them.
 *
 * Three copies of the authored-shape accessors used to exist — one in
 * blueprint-core, one here, one inside generate-html.js — and they drifted.
 * This is the only one.
 */

/**
 * A state machine document as the renderers read it.
 *
 * `model()` normalizes the machines and their steps but says nothing about the
 * document around them, so the fields a page header needs — the domain, the
 * spec it points at, the file it came from — still come off the Doc. This
 * pairs the two, once per document, rather than having each renderer reach
 * into both and call `model()` again on every event link it draws.
 *
 * @param {import('@codeforamerica/blueprint-core').Doc} doc
 * @returns {{ path: string, domain: string, apiSpec: string, machines: object[], procedures: object[] }}
 */
export function stateMachineView(doc) {
  const model = doc.model();
  return {
    path: doc.path,
    domain: doc.domain,
    apiSpec: doc.content?.apiSpec,
    machines: model?.machines ?? [],
    procedures: model?.procedures ?? [],
  };
}

/**
 * The body of a branch, by kind.
 *
 * An `if` node's children are a `then` node and optionally an `else` node;
 * this returns the steps inside whichever is asked for.
 *
 * @param {object} step - A normalized `if` step
 * @param {'then'|'else'} branch
 * @returns {object[]} The steps in that branch, empty if it has none
 */
export function branchSteps(step, branch) {
  return step?.children?.find((child) => child.kind === branch)?.children ?? [];
}

/**
 * A `match` step's cases, as value to steps.
 *
 * @param {object} step - A normalized `match` step
 * @returns {Array<[string, object[]]>} Case value and its steps, in order
 */
export function matchCases(step) {
  return (step?.children ?? [])
    .filter((child) => child.kind === 'case')
    .map((child) => [child.value, child.children ?? []]);
}

/**
 * A `forEach` step's body.
 *
 * @param {object} step - A normalized `forEach` step
 * @returns {object[]}
 */
export function forEachBody(step) {
  return step?.children ?? [];
}

/**
 * Every event type emitted anywhere beneath these steps.
 *
 * Recurses through branch and loop bodies, because an emit inside an `if`
 * is still an emit the domain publishes.
 *
 * @param {object[]} steps - Normalized steps
 * @returns {string[]}
 */
export function emittedTypes(steps) {
  const found = [];

  for (const step of steps ?? []) {
    if (step.kind === 'emit' && step.type) found.push(step.type);
    found.push(...emittedTypes(step.children));
  }

  return found;
}

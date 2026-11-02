/**
 * Every step of a state machine's steps, at any depth: the steps themselves,
 * and those inside an if's `then` and `else`, a forEach's `do` (written beside
 * it, or inside it), a call's `catch.do`, and each branch of a match's `when`.
 * Checks and generators that look for one kind of step filter this, so they
 * all reach the same steps.
 *
 * @param {Object[]} steps
 * @returns {Generator<Object>}
 */
export function* everyStep(steps) {
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    yield step;
    yield* everyStep(step.then);
    yield* everyStep(step.else);
    yield* everyStep(step.do);
    yield* everyStep(step.catch?.do);
    yield* everyStep(step.forEach?.do);
    for (const branch of Object.values(step.when && typeof step.when === 'object' ? step.when : {})) {
      yield* everyStep(branch);
    }
  }
}

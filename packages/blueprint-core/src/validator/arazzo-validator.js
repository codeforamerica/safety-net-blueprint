/**
 * Arazzo scenarios: a sound shape, and steps that call operations the set has.
 *
 * A scenario names each step's operation by operationId, so a typo or a
 * renamed operation would only show when the scenario ran. The operations a
 * set has include the ones resolve generates — state machine actions,
 * composition endpoints, ruleset endpoints — which a source contract set does
 * not yet contain, so they are generated here the way resolve generates them,
 * and their names are never worked out a second time.
 */

/** Operation ids declared in a set of OpenAPI paths. */
function idsIn(paths, out) {
  for (const item of Object.values(paths ?? {})) {
    for (const method of ['get', 'put', 'post', 'patch', 'delete']) {
      const id = item?.[method]?.operationId;
      if (id) out.add(id);
    }
  }
}

/**
 * Every operation id the set will have once resolved.
 *
 * @param {import('../types.js').Doc[]} docs
 * @param {{ generatedOverlays: Function, rulesApis: Function }} generators - core's,
 *   passed in to avoid an import cycle
 * @returns {Set<string>|null} Null when the set cannot be generated, so ids are not checked
 */
export function operationIdsOf(docs, { generatedOverlays, rulesApis }) {
  const ids = new Set();
  for (const doc of docs.filter((d) => d.type === 'openapi')) idsIn(doc.content?.paths, ids);
  try {
    for (const overlay of generatedOverlays(docs)) {
      for (const action of overlay.actions ?? []) {
        if (action.target === '$.paths') idsIn(action.update, ids);
      }
    }
    for (const api of rulesApis(docs)) idsIn(api.content?.paths, ids);
  } catch {
    return null; // The set does not generate; that is reported where it fails.
  }
  return ids;
}

/**
 * @param {import('../types.js').Doc} doc - An Arazzo document
 * @param {Set<string>|null} operationIds - From operationIdsOf
 * @returns {object[]} Errors
 */
export function validateArazzo(doc, operationIds) {
  const errors = [];
  const c = doc.content ?? {};
  const at = (where) => `${doc.path}#${where}`;
  const err = (rule, message, where) => errors.push({ rule, message, path: at(where) });

  if (typeof c.arazzo !== 'string') err('arazzo-shape', 'An Arazzo document declares its specification version in `arazzo`.', 'arazzo');
  if (!c.info?.title || !c.info?.version) err('arazzo-shape', '`info` needs a title and a version.', 'info');
  if (!Array.isArray(c.sourceDescriptions) || c.sourceDescriptions.length === 0) {
    err('arazzo-shape', '`sourceDescriptions` names at least one API the scenario calls.', 'sourceDescriptions');
  }
  if (!Array.isArray(c.workflows) || c.workflows.length === 0) err('arazzo-shape', '`workflows` has at least one workflow.', 'workflows');

  const sources = new Map((c.sourceDescriptions ?? []).map((source) => [source.name, source]));
  const outside = (source) => /^https?:\/\//.test(source?.url ?? '');

  for (const workflow of c.workflows ?? []) {
    const where = `workflows[${workflow.workflowId ?? '?'}]`;
    if (!workflow.workflowId) err('arazzo-shape', 'Each workflow has a workflowId.', where);
    const seen = new Set();
    for (const step of workflow.steps ?? []) {
      const stepWhere = `${where}.steps[${step.stepId ?? '?'}]`;
      if (!step.stepId) err('arazzo-shape', 'Each step has a stepId.', stepWhere);
      else if (seen.has(step.stepId)) err('arazzo-shape', `stepId "${step.stepId}" appears twice in this workflow.`, stepWhere);

      const targets = ['operationId', 'operationPath', 'workflowId'].filter((k) => step[k] !== undefined);
      if (targets.length !== 1) err('arazzo-shape', 'A step names exactly one of operationId, operationPath or workflowId.', stepWhere);
      if (step.operationId) {
        // With more than one source, Arazzo requires each operation to say
        // which it belongs to: `$sourceDescriptions.<name>.<operationId>`.
        const qualified = /^\$sourceDescriptions\.([^.]+)\.(.+)$/.exec(step.operationId);
        const source = qualified ? sources.get(qualified[1]) : null;
        const id = qualified ? qualified[2] : step.operationId;
        if (qualified && !source) {
          err('arazzo-shape', `Step "${step.stepId}" names source "${qualified[1]}", which sourceDescriptions does not declare.`, stepWhere);
        } else if (!qualified && sources.size > 1) {
          err('arazzo-shape', `Step "${step.stepId}" names ${id} without its source; with more than one source, write $sourceDescriptions.<name>.${id}.`, stepWhere);
        } else if (operationIds && !outside(source) && !operationIds.has(id)) {
          // A source outside the set — the mock's own routes, by URL — is
          // checked where it is served, not here.
          err('unknown-operation', `Step "${step.stepId}" calls ${id}, which no API in the set declares.`, stepWhere);
        }
      }

      // A step can carry forward only what an earlier step produced.
      const referenced = [...JSON.stringify(step).matchAll(/\$steps\.([A-Za-z0-9_-]+)\./g)].map((m) => m[1]);
      for (const name of new Set(referenced)) {
        if (!seen.has(name)) err('unknown-step', `Step "${step.stepId}" refers to $steps.${name}, which is not an earlier step in this workflow.`, stepWhere);
      }
      if (step.stepId) seen.add(step.stepId);
    }
  }
  return errors;
}

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

  // Who takes part (docs/conventions/extensions.yaml, x-actors): listed once
  // under info, then named by id on the steps they act in.
  const actors = new Set();
  if (c.info?.['x-actors'] !== undefined && !Array.isArray(c.info['x-actors'])) {
    err('arazzo-shape', '`info.x-actors` is a list of actors.', 'info.x-actors');
  }
  for (const [i, actor] of (Array.isArray(c.info?.['x-actors']) ? c.info['x-actors'] : []).entries()) {
    const where = `info.x-actors[${i}]`;
    if (!actor?.id || !actor?.name) err('arazzo-shape', 'Each actor has an id and a name.', where);
    else if (actors.has(actor.id)) err('arazzo-shape', `Actor "${actor.id}" is listed twice.`, where);
    if (actor?.id) actors.add(actor.id);
  }

  const workflowsById = new Map((c.workflows ?? []).map((w) => [w.workflowId, w]));
  for (const workflow of c.workflows ?? []) {
    const where = `workflows[${workflow.workflowId ?? '?'}]`;
    if (!workflow.workflowId) err('arazzo-shape', 'Each workflow has a workflowId.', where);
    for (const dependency of workflow.dependsOn ?? []) {
      if (!workflowsById.has(dependency)) err('unknown-workflow', `Workflow "${workflow.workflowId}" depends on "${dependency}", which this document does not declare.`, where);
    }
    // A workflow reads another's outputs only when it depends on it, and only
    // the outputs that one declares.
    const fromWorkflows = (value, place) => {
      for (const [, id, name] of JSON.stringify(value).matchAll(/\$workflows\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_-]+)/g)) {
        if (!(workflow.dependsOn ?? []).includes(id)) err('unknown-workflow', `${place} refers to $workflows.${id}, which "${workflow.workflowId}" does not depend on.`, where);
        else if (!(name in (workflowsById.get(id)?.outputs ?? {}))) err('unknown-workflow', `${place} refers to $workflows.${id}.outputs.${name}, which "${id}" does not declare.`, where);
      }
    };
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

      if (step['x-actors'] !== undefined) {
        if (!Array.isArray(step['x-actors'])) {
          err('arazzo-shape', `Step "${step.stepId}"'s x-actors is a list of actor ids.`, stepWhere);
        } else {
          for (const id of step['x-actors']) {
            if (!actors.has(id)) err('unknown-actor', `Step "${step.stepId}" names actor "${id}", which info.x-actors does not list.`, stepWhere);
          }
        }
      }

      // A step can carry forward only what an earlier step produced.
      const referenced = [...JSON.stringify(step).matchAll(/\$steps\.([A-Za-z0-9_-]+)\./g)].map((m) => m[1]);
      for (const name of new Set(referenced)) {
        if (!seen.has(name)) err('unknown-step', `Step "${step.stepId}" refers to $steps.${name}, which is not an earlier step in this workflow.`, stepWhere);
      }
      fromWorkflows(step, `Step "${step.stepId}"`);
      if (step.stepId) seen.add(step.stepId);
    }
    // A workflow's outputs come from its own steps.
    for (const name of new Set([...JSON.stringify(workflow.outputs ?? {}).matchAll(/\$steps\.([A-Za-z0-9_-]+)\./g)].map((m) => m[1]))) {
      if (!seen.has(name)) err('unknown-step', `Workflow "${workflow.workflowId}"'s outputs refer to $steps.${name}, which is not a step in this workflow.`, where);
    }
    fromWorkflows(workflow.outputs ?? {}, `Workflow "${workflow.workflowId}"'s outputs`);
  }
  return errors;
}

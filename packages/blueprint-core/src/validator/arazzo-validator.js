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

import { normalizeRefPath } from '../ref-lookup.js';

/**
 * @param {import('../types.js').Doc} doc - An Arazzo document
 * @param {ReturnType<import('../operations.js').readOperations>} operations - The
 *   set's, from extract(docs, 'operations'); null skips checking that steps' operations exist
 * @param {import('../types.js').Doc[]} [docs] - The set's documents, to find
 *   the Arazzo document a step runs a workflow from; omitted skips checking that it declares it
 * @returns {object[]} Errors
 */
export function validateArazzo(doc, operations, docs = null) {
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

  // A step runs a workflow of this document by its workflowId, or of another
  // Arazzo document by `$sourceDescriptions.<name>.<workflowId>`, where the
  // source is of type arazzo.
  const workflowExists = (step, where) => {
    const qualified = /^\$sourceDescriptions\.([^.]+)\.(.+)$/.exec(String(step.workflowId));
    if (!qualified) {
      if (!workflowsById.has(step.workflowId)) err('unknown-workflow', `Step "${step.stepId}" runs workflow "${step.workflowId}", which this document does not declare.`, where);
      return;
    }
    const source = sources.get(qualified[1]);
    if (!source) {
      err('arazzo-shape', `Step "${step.stepId}" names source "${qualified[1]}", which sourceDescriptions does not declare.`, where);
    } else if (source.type !== 'arazzo') {
      err('arazzo-shape', `Step "${step.stepId}" runs a workflow from "${qualified[1]}", a source of type ${source.type ?? 'unknown'}; a workflow's source is of type arazzo.`, where);
    } else if (docs && !outside(source)) {
      const file = normalizeRefPath(source.url ?? '', doc.relativePath);
      const other = docs.find((d) => d.type === 'arazzo' && d.relativePath === file);
      if (!other) err('unknown-workflow', `Step "${step.stepId}" runs a workflow from ${source.url}, which isn't an Arazzo document in the set.`, where);
      else if (!(other.content?.workflows ?? []).some((w) => w.workflowId === qualified[2])) {
        err('unknown-workflow', `Step "${step.stepId}" runs workflow "${qualified[2]}", which ${source.url} does not declare.`, where);
      }
    }
  };
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
        const source = qualified ? sources.get(qualified[1]) : (sources.size === 1 ? [...sources.values()][0] : null);
        const id = qualified ? qualified[2] : step.operationId;
        if (qualified && !source) {
          err('arazzo-shape', `Step "${step.stepId}" names source "${qualified[1]}", which sourceDescriptions does not declare.`, stepWhere);
        } else if (!qualified && sources.size > 1) {
          err('arazzo-shape', `Step "${step.stepId}" names ${id} without its source; with more than one source, write $sourceDescriptions.<name>.${id}.`, stepWhere);
        } else if (operations && source && !outside(source)) {
          // The operation is looked for in its source's document, not anywhere
          // in the set. A source outside the set — the mock's own routes, by
          // URL — is checked where it is served, not here.
          const file = normalizeRefPath(source.url ?? '', doc.relativePath);
          const { candidates } = operations.find(id, { file });
          if (candidates.length === 0) {
            const elsewhere = operations.find(id).candidates;
            err('unknown-operation', elsewhere.length
              ? `Step "${step.stepId}" calls ${id}, which ${source.url} doesn't declare; ${elsewhere.map((o) => o.file).join(' and ')} does.`
              : `Step "${step.stepId}" calls ${id}, which no API in the set declares.`, stepWhere);
          }
        }
      }

      if (targets.length === 1 && step.workflowId !== undefined) workflowExists(step, stepWhere);

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

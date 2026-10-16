/**
 * Derive RPC endpoints from state machine transitions.
 *
 * A state machine action — `claim`, `escalate` — is an operation on the
 * resource, but the REST spec only describes the resource itself. This
 * projects each action into an endpoint on the item path, so the transitions
 * a state machine declares are part of the API it describes rather than
 * something a client has to know out of band.
 *
 * Produces an overlay, like the composition and rules generators; `resolve`
 * applies it.
 */

import { governedResource } from '../attachment.js';
import { buildParameterIndex, buildPathEntry, extractRefName } from '../openapi/utils.js';
import { detectComponentPrefix, rewriteComponentRefs } from './refs.js';

// =============================================================================
// Argument Parsing
// =============================================================================

/**
 * The operationId of a transition endpoint: `claim` on Task is `claimTask`.
 * @param {string} trigger - The action id
 * @param {string} objectName - The machine's object
 * @returns {string}
 */
export function buildOperationId(trigger, objectName) {
  return `${trigger}${objectName}`;
}

/**
 * Build an OpenAPI requestBody object from a transition's schema.request definition.
 * @param {Object|null} requestSchema - The schema.request value (resolved JSON Schema object)
 * @returns {Object|null} OpenAPI requestBody object, or null if no schema provided
 */
function buildRequestBody(requestSchema) {
  if (!requestSchema) return null;
  return {
    required: true,
    content: {
      'application/json': {
        // Deep-clone so rewriteLocalDefsRefs does not mutate the source
        // state machine object (which would corrupt the resolved YAML output).
        schema: JSON.parse(JSON.stringify(requestSchema))
      }
    }
  };
}

/**
 * Walk a JSON value in place. For every local `#/$defs/<Name>` $ref encountered,
 * rewrite it to `#/components/schemas/<Name>` and add `<Name>` to `collected`.
 * Cross-file refs (e.g. `./foo.yaml#/$defs/X`) and non-$defs refs are left alone.
 *
 * The state-machine YAML is a JSON Schema document with a root `$defs` block, so
 * actions reference request/response shapes as `#/$defs/<Name>`. When those refs
 * are inlined verbatim into an OpenAPI spec they dangle, because OpenAPI specs
 * don't carry a root `$defs` block — schemas live under `#/components/schemas`.
 *
 * @param {*} node - The JSON value to walk (mutated in place)
 * @param {Set<string>} collected - Set to add hoisted schema names to
 */
function rewriteLocalDefsRefs(node, collected) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) rewriteLocalDefsRefs(item, collected);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string' && value.startsWith('#/$defs/')) {
      const name = extractRefName(value);
      collected.add(name);
      node[key] = `#/components/schemas/${name}`;
    } else {
      rewriteLocalDefsRefs(value, collected);
    }
  }
}

/**
 * Build the transitive closure of `$defs` entries needed to satisfy `rootNames`
 * against the state-machine's `$defs` block. Each hoisted entry is deep-cloned
 * and has its own local `#/$defs/...` refs rewritten to `#/components/schemas/...`
 * form before being added to the result.
 *
 * @param {Object|undefined} defs - The state machine's `$defs` object
 * @param {Set<string>} rootNames - Initial set of needed schema names (from action ops)
 * @param {string} domain - State machine domain (for warning messages)
 * @returns {Object} Plain object (name → schema) suitable as an overlay `update` payload
 */
function hoistDefs(defs, rootNames, domain) {
  const hoisted = {};
  const queue = [...rootNames];
  while (queue.length > 0) {
    const name = queue.shift();
    if (Object.prototype.hasOwnProperty.call(hoisted, name)) continue;
    const original = defs && defs[name];
    if (!original) {
      console.warn(
        `  ${domain}: state-machine action references #/$defs/${name} but no matching entry exists; ref will dangle`
      );
      continue;
    }
    const clone = JSON.parse(JSON.stringify(original));
    const nested = new Set();
    rewriteLocalDefsRefs(clone, nested);
    hoisted[name] = clone;
    for (const nestedName of nested) {
      if (!Object.prototype.hasOwnProperty.call(hoisted, nestedName)) {
        queue.push(nestedName);
      }
    }
  }
  return hoisted;
}

/**
 * Generate an OpenAPI overlay for a single state machine.
 * @param {Object} stateMachine - The parsed state machine contract
 * @param {{ itemPath: string, paramRefs: Array, tag: string, schemaRef: string }} endpointInfo
 * @returns {Object} Overlay document
 */
export function generateOverlay(stateMachine, endpointInfo) {
  const { itemPath, schemaRef, relativePath, spec } = endpointInfo;
  const apiSpecRef = relativePath || stateMachine.apiSpec;

  const paramIndex = spec ? buildParameterIndex([{ relativePath: apiSpecRef, spec }]) : new Map();

  const pathsUpdate = {};
  const seenIds = new Set();

  for (const machine of (stateMachine.machines || [])) {
    const objectName = machine.object || stateMachine.object;

    for (const transition of (machine.actions || [])) {
      // Deduplicate — same id may appear for different from-states (e.g. escalate)
      if (seenIds.has(transition.id)) continue;
      seenIds.add(transition.id);

      const rpcPath = `${itemPath}/${transition.id}`;
      const operationId = buildOperationId(transition.id, objectName);
      const from = transition.transition?.from;
      const to = transition.transition?.to ?? '(in-place)';
      const fromLabel = Array.isArray(from) ? from.join(' | ') : (from ?? '?');

      const operation = {
        summary: `${transition.id.charAt(0).toUpperCase() + transition.id.slice(1).replace(/-/g, ' ')} ${objectName.toLowerCase()}`,
        description: transition.description || `Trigger the ${transition.id} transition (${fromLabel} → ${to}).`,
        operationId,
      };

      const requestBody = buildRequestBody(transition.schema?.request || null);
      if (requestBody) {
        operation.requestBody = requestBody;
      }

      const responseSchema = transition.schema?.response
        ? JSON.parse(JSON.stringify(transition.schema.response))
        : (schemaRef ? { $ref: schemaRef } : { type: 'object' });

      operation.responses = {
        '200': {
          description: 'Transition applied successfully.',
          content: { 'application/json': { schema: responseSchema } }
        },
        '400': { $ref: './components/responses.yaml#/BadRequest' },
        '404': { $ref: './components/responses.yaml#/NotFound' },
        '409': { $ref: './components/responses.yaml#/Conflict' },
        '500': { $ref: './components/responses.yaml#/InternalError' }
      };

      pathsUpdate[rpcPath] = buildPathEntry(rpcPath, 'post', operation, paramIndex, {
        type: 'state-machine-action',
        domain: stateMachine.domain,
        id: transition.id,
      });
    }
  }

  // Walk the generated operations for local `#/$defs/<Name>` refs (carried over
  // from the state-machine YAML's `$defs:` block) and rewrite them to
  // `#/components/schemas/<Name>` so they resolve in the destination OpenAPI.
  // Then build a second overlay action that hoists the referenced $defs entries
  // (transitively) into `components.schemas`.
  const neededDefs = new Set();
  rewriteLocalDefsRefs(pathsUpdate, neededDefs);
  const hoistedSchemas = hoistDefs(stateMachine.$defs, neededDefs, stateMachine.domain);

  const actions = [
    {
      target: '$.paths',
      file: apiSpecRef,
      description: `Add state machine transition endpoints for ${stateMachine.domain}`,
      update: pathsUpdate
    }
  ];

  if (Object.keys(hoistedSchemas).length > 0) {
    actions.push({
      target: '$.components.schemas',
      file: apiSpecRef,
      description: `Hoist state-machine action $defs into components.schemas for ${stateMachine.domain}`,
      update: hoistedSchemas
    });
  }

  return {
    overlay: '1.0.0',
    info: {
      title: `${stateMachine.domain} RPC Overlay`,
      version: '1.0.0',
      description: `Auto-generated RPC endpoints from ${stateMachine.domain}-state-machine.yaml`
    },
    actions
  };
}

// =============================================================================
// Main
// =============================================================================

/**
 * RPC overlays for every state machine in the set.
 *
 * Each machine governs the resource in its domain named for its object, and
 * its actions become endpoints on that resource's item path, in the document
 * that declares it. One overlay per machine: the machines of one document can
 * govern different resources — intake's Verification sits under its
 * application, not on the application's own path.
 *
 * @param {import('../../types.js').Doc[]} docs
 * @returns {{ domain: string, overlay: object, actionCount: number }[]}
 */
export function generateRpcOverlays(docs) {
  const overlays = [];

  for (const doc of docs) {
    if (doc.type !== 'state-machine') continue;

    const stateMachine = doc.content;
    if (!stateMachine?.domain || !Array.isArray(stateMachine.machines)) continue;

    for (const machine of stateMachine.machines) {
      if (!machine?.object) continue;

      const governed = governedResource(docs, stateMachine.domain, machine.object);
      if (!governed) continue;
      const { api, resource } = governed;

      const itemPath = resource.path('item');
      const getOperation = api.content.paths?.[itemPath]?.get;
      const overlay = generateOverlay(
        { ...stateMachine, machines: [machine] },
        {
          itemPath,
          schemaRef: getOperation?.responses?.['200']?.content?.['application/json']?.schema?.$ref ?? null,
          relativePath: api.relativePath ?? api.path,
          spec: api.content,
        },
      );

      overlays.push({
        domain: stateMachine.domain,
        overlay: rewriteComponentRefs(overlay, './', detectComponentPrefix(api.content)),
        actionCount: (machine.actions ?? []).length,
      });
    }
  }

  return overlays;
}

// Exported for unit tests. Not part of the package's public surface — these
// are steps within overlay generation, not operations a consumer performs.
export { buildRequestBody, rewriteLocalDefsRefs, hoistDefs };

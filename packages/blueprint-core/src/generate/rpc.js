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

import { everyStep } from '../steps.js';
import { governedResource } from '../attachment.js';
import { buildParameterIndex, buildPathEntry, extractRefName } from '../openapi/utils.js';
import { detectComponentPrefix, rewriteComponentRefs } from './refs.js';

// =============================================================================
// Argument Parsing
// =============================================================================

/**
 * The operationId of a transition endpoint: `claim` on Task is `claimTask`,
 * and an action id of several words is camelCased — `process-suggestions` on
 * Interview is `processSuggestionsInterview`.
 * @param {string} trigger - The action id, in kebab-case
 * @param {string} objectName - The machine's object
 * @returns {string}
 */
export function buildOperationId(trigger, objectName) {
  return `${trigger.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())}${objectName}`;
}

/**
 * Build an OpenAPI requestBody object from a transition's schema.request definition.
 * @param {Object|null} requestSchema - The schema.request value (resolved JSON Schema object)
 * @returns {Object|null} OpenAPI requestBody object, or null if no schema provided
 */
function buildRequestBody(requestSchema, defs = {}) {
  if (!requestSchema) return null;
  return {
    // Written only when true: false is OpenAPI's default (naming.yaml, omit_defaults).
    ...(requiresSomething(requestSchema, defs) ? { required: true } : {}),
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
 * Whether a request schema needs a body: it requires a property, or sets
 * minProperties. A schema that requires nothing can be left out, as accepting
 * a suggestion as proposed sends no body. A reference into the machine's own
 * $defs is followed; one that can't be is taken to need a body.
 * @param {Object} schema
 * @param {Object} defs - The state machine's $defs
 * @returns {boolean}
 */
function requiresSomething(schema, defs) {
  const local = typeof schema?.$ref === 'string' ? /^#\/\$defs\/(.+)$/.exec(schema.$ref) : null;
  if (schema?.$ref) {
    if (!local || !defs[local[1]]) return true;
    return requiresSomething(defs[local[1]], defs);
  }
  return (schema?.required ?? []).length > 0 || (schema?.minProperties ?? 0) > 0;
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
 * Whether an action's own steps call another operation: a `call` naming an
 * operation, or one whose call is a runtime expression (`$request.call`). A
 * `call` of a bare name runs a procedure, and is not counted.
 * @param {Object[]} steps
 * @returns {boolean}
 */
function callsAnOperation(steps) {
  for (const { call } of everyStep(steps)) {
    if (call && typeof call === 'object') return true;
    if (typeof call === 'string' && call.startsWith('$')) return true;
  }
  return false;
}

const CALL_FAILURE = 'It calls another operation. When that call fails, the action answers with the call\'s own status and error, so a 404 or 422 can be about the record the call names. When the action catches the failure, `details[0]` is this record as it now is.';

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

      const calls = callsAnOperation(transition.steps);
      const described = transition.description || `Trigger the ${transition.id} transition (${fromLabel} → ${to}).`;
      const operation = {
        summary: `${transition.id.charAt(0).toUpperCase() + transition.id.slice(1).replace(/-/g, ' ')} ${objectName.toLowerCase()}`,
        description: calls ? `${described}\n\n${CALL_FAILURE}` : described,
        operationId,
      };

      const requestBody = buildRequestBody(transition.schema?.request || null, stateMachine.$defs);
      if (requestBody) {
        operation.requestBody = requestBody;
      }

      // What the action answers with: its response's schema, or the
      // deprecated schema.response, or else the record.
      const declared = transition.response?.schema ?? transition.schema?.response;
      const responseSchema = declared
        ? JSON.parse(JSON.stringify(declared))
        : (schemaRef ? { $ref: schemaRef } : { type: 'object' });

      operation.responses = {
        '200': {
          description: 'Transition applied successfully.',
          content: { 'application/json': { schema: responseSchema } }
        },
        '400': { $ref: './components/responses.yaml#/BadRequest' },
        // A guard can name the roles allowed to take the action.
        '403': { $ref: './components/responses.yaml#/Forbidden' },
        '404': { $ref: './components/responses.yaml#/NotFound' },
        '409': {
          description: 'The record is in a state this action can\'t start from, or one of its guards isn\'t met.',
          content: { 'application/json': { schema: { $ref: './components/responses.yaml#/Error' } } },
        },
        ...(requestBody || calls ? { '422': { $ref: './components/responses.yaml#/UnprocessableEntity' } } : {}),
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

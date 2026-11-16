/**
 * State Machine Cross-Artifact Validator
 *
 * Exports pure functions for validating state machine YAML documents:
 *   validateWithinFile   — within-file consistency (no resolved specs needed)
 *   validateCrossArtifact — field refs, enum values, endpoints (needs resolved specs)
 *
 * Both return an array of { rule, message, path } error objects.
 */

import { qualifiedRef } from '../operations.js';
import { everyStep } from '../steps.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import yaml from 'js-yaml';
import { resolveSchemaRefs, resolveRef, collectTopLevelProperties, getPropertyAtPath } from '../json-schema/index.js';
import { snakeCase } from '../event-names.js';

// Generic base roles. Domain packages (e.g. safety-net) pass their own validRoles
// to validateWithinFile to extend or replace this set.
export const VALID_ACTOR_ROLES = new Set(['readonly', 'readwrite', 'admin', 'system']);

// Variables whose schema is provided by the runtime, not declared in context
export const SYSTEM_VARIABLES = new Set(['this', 'caller', 'now', 'request', 'params', 'push', 'merge']);

// =============================================================================
// String pattern extraction
// =============================================================================

const FIELD_REF_RE = /\$([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)/g;

/** Extract all $variable.field.path references from a string. */
export function extractFieldRefs(str) {
  if (typeof str !== 'string') return [];
  const refs = [];
  let m;
  FIELD_REF_RE.lastIndex = 0;
  while ((m = FIELD_REF_RE.exec(str)) !== null) {
    refs.push({ variable: m[1], field: m[2] });
  }
  return refs;
}

const ENUM_IN_RE = /"([^"]+)"\s+in\s+\$([a-zA-Z_]+)\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
const ENUM_EQ_FIELD_RE = /\$([a-zA-Z_]+)\.([a-zA-Z_][a-zA-Z0-9_]*)\s*==\s*"([^"]+)"/g;
const ENUM_EQ_VAL_RE = /"([^"]+)"\s*==\s*\$([a-zA-Z_]+)\.([a-zA-Z_][a-zA-Z0-9_]*)/g;

/** Extract enum string literal comparisons: "val" in $var.field | $var.field == "val" | "val" == $var.field */
export function extractEnumComparisons(str) {
  if (typeof str !== 'string') return [];
  const comparisons = [];
  let m;

  ENUM_IN_RE.lastIndex = 0;
  while ((m = ENUM_IN_RE.exec(str)) !== null) comparisons.push({ value: m[1], variable: m[2], field: m[3] });

  ENUM_EQ_FIELD_RE.lastIndex = 0;
  while ((m = ENUM_EQ_FIELD_RE.exec(str)) !== null) comparisons.push({ value: m[3], variable: m[1], field: m[2] });

  ENUM_EQ_VAL_RE.lastIndex = 0;
  while ((m = ENUM_EQ_VAL_RE.exec(str)) !== null) comparisons.push({ value: m[1], variable: m[2], field: m[3] });

  return comparisons;
}

// =============================================================================
// Document utilities
// =============================================================================

/** Parse context: [{varName: {from: 'domain/collection'}}] → Map<varName, fromPath> */
export function collectContextBindings(contextArray) {
  const bindings = new Map();
  if (!Array.isArray(contextArray)) return bindings;
  for (const item of contextArray) {
    if (!item || typeof item !== 'object') continue;
    for (const [varName, binding] of Object.entries(item)) {
      if (typeof binding === 'object' && binding?.from != null) {
        bindings.set(varName, String(binding.from));
      }
    }
  }
  return bindings;
}

export function loadExtendsDoc(filePath, extendsPath) {
  if (!extendsPath) return null;
  try {
    const dir = dirname(filePath);
    const extPath = join(dir, extendsPath.replace(/^\.\//, ''));
    return yaml.load(readFileSync(extPath, 'utf8'), { schema: yaml.DEFAULT_SCHEMA });
  } catch {
    return null;
  }
}

/** Collect all declared guard IDs (in the file + extends chain). */
export function collectGuardIds(doc, filePath) {
  const ids = new Set();
  for (const g of (doc.guards || [])) if (g?.id) ids.add(g.id);
  for (const machine of (doc.machines || [])) {
    for (const g of (machine.guards || [])) if (g?.id) ids.add(g.id);
  }
  if (doc.extends) {
    const ext = loadExtendsDoc(filePath, doc.extends);
    if (ext) for (const g of (ext.guards || [])) if (g?.id) ids.add(g.id);
  }
  return ids;
}

/** Collect all callable IDs (procedures + actions) visible from a machine. */
export function collectCallableIds(doc, machine, filePath) {
  const ids = new Set();
  for (const p of (machine.procedures || [])) if (p?.id) ids.add(p.id);
  for (const a of (machine.actions || [])) if (a?.id) ids.add(a.id);
  for (const p of (doc.procedures || [])) if (p?.id) ids.add(p.id);
  if (doc.extends) {
    const ext = loadExtendsDoc(filePath, doc.extends);
    if (ext) for (const p of (ext.procedures || [])) if (p?.id) ids.add(p.id);
  }
  return ids;
}

/** Extract condition IDs from a conditions array (handles string, {any:}, {all:} forms). */
export function extractConditionIds(conditions) {
  const ids = [];
  for (const cond of (conditions || [])) {
    if (typeof cond === 'string') {
      ids.push(cond);
    } else if (cond?.any) {
      for (const c of cond.any) if (typeof c === 'string') ids.push(c);
    } else if (cond?.all) {
      for (const c of cond.all) if (typeof c === 'string') ids.push(c);
    }
  }
  return ids;
}

function* walkCallStrings(steps) {
  for (const step of everyStep(steps)) {
    // A string starting with $ holds a call to an operation, not a procedure's name.
    if (typeof step.call === 'string' && !step.call.startsWith('$')) yield step.call;
  }
}

/**
 * Steps with a `catch:` that can never run, or a `bind:` that never binds:
 * on a call by method and path, or to a procedure. Only a call to an operation
 * — `call: { operationId }` or a `$` value holding one — reports a failure and
 * answers with a response; the others are logged, and written after the steps.
 */
function* walkUnreachableFailures(steps) {
  for (const step of everyStep(steps)) {
    if ((step.catch || step.bind) && step.call !== undefined) {
      const operation = typeof step.call === 'string' ? step.call.startsWith('$') : 'operationId' in (step.call ?? {});
      if (!operation) yield step;
    }
  }
}

/** The errors for a catch: that can never run and a bind: that never binds, naming the call. */
function unreachableFailure(step, path) {
  const named = typeof step.call === 'string'
    ? `procedure "${step.call}"`
    : ['POST', 'PATCH', 'GET', 'DELETE'].filter((m) => m in step.call).map((m) => `${m} ${step.call[m]}`)[0] ?? 'this call';
  const errors = [];
  if (step.catch) {
    errors.push({
      rule: 'catch-never-runs',
      message: `catch: on the call to ${named} never runs — only a call to an operation, by operationId or a $ value holding one, reports a failure. Call the operation by its operationId to handle one.`,
      path,
    });
  }
  if (step.bind) {
    errors.push({
      rule: 'bind-never-binds',
      message: `bind: on the call to ${named} never binds — only a call to an operation, by operationId or a $ value holding one, answers with a response the steps after it can read. Call the operation by its operationId to bind what it answers.`,
      path,
    });
  }
  return errors;
}

/** The operationIds of the calls to operations in steps, wherever they stand. */
function* walkOperationCalls(steps) {
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    if (typeof step.call?.operationId === 'string') yield step.call.operationId;
    yield* walkOperationCalls(step.then);
    yield* walkOperationCalls(step.else);
    yield* walkOperationCalls(step.do);
    yield* walkOperationCalls(step.catch?.do);
    if (step.when && typeof step.when === 'object') {
      for (const substeps of Object.values(step.when)) yield* walkOperationCalls(substeps);
    }
    if (step.forEach?.do) yield* walkOperationCalls(step.forEach.do);
  }
}

function* walkSetFields(steps) {
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    if (step.set?.field) yield step.set.field;
    yield* walkSetFields(step.then);
    yield* walkSetFields(step.else);
    yield* walkSetFields(step.do);
    yield* walkSetFields(step.catch?.do);
    if (step.when && typeof step.when === 'object') {
      for (const substeps of Object.values(step.when)) yield* walkSetFields(substeps);
    }
    if (step.forEach?.do) yield* walkSetFields(step.forEach.do);
  }
}

function* walkObjectCalls(steps) {
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    if (step.call && typeof step.call === 'object') {
      for (const [method, callPath] of Object.entries(step.call)) {
        if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) {
          yield { method: method.toUpperCase(), callPath: String(callPath) };
        }
      }
    }
    yield* walkObjectCalls(step.then);
    yield* walkObjectCalls(step.else);
    yield* walkObjectCalls(step.do);
    if (step.when && typeof step.when === 'object') {
      for (const substeps of Object.values(step.when)) yield* walkObjectCalls(substeps);
    }
    if (step.forEach?.do) yield* walkObjectCalls(step.forEach.do);
  }
}

/**
 * The body a call step sends: its `requestBody.payload`, or the deprecated
 * `body:` beside the method.
 */
function payloadOf(step) {
  return step.call?.requestBody?.payload ?? step.call?.body;
}

export function* walkPushBodiesInCalls(steps) {
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    if (step.call && typeof step.call === 'object') {
      for (const [method, callPath] of Object.entries(step.call)) {
        const payload = payloadOf(step);
        if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase()) && payload && typeof payload === 'object') {
          for (const [bodyField, bodyVal] of Object.entries(payload)) {
            if (bodyVal && typeof bodyVal === 'object' && bodyVal.$push && typeof bodyVal.$push === 'object') {
              yield { method: method.toUpperCase(), callPath: String(callPath), bodyField, pushBody: bodyVal.$push };
            }
          }
        }
      }
    }
    yield* walkPushBodiesInCalls(step.then);
    yield* walkPushBodiesInCalls(step.else);
    yield* walkPushBodiesInCalls(step.do);
    if (step.when && typeof step.when === 'object') {
      for (const substeps of Object.values(step.when)) yield* walkPushBodiesInCalls(substeps);
    }
    if (step.forEach?.do) yield* walkPushBodiesInCalls(step.forEach.do);
  }
}

// Walk all string values in a node, skipping description and $schema keys
function* walkAllStrings(node) {
  if (typeof node === 'string') {
    yield node;
  } else if (Array.isArray(node)) {
    for (const item of node) yield* walkAllStrings(item);
  } else if (node && typeof node === 'object') {
    for (const [key, val] of Object.entries(node)) {
      if (key === 'description' || key === '$schema' || key === 'type') continue;
      yield* walkAllStrings(val);
    }
  }
}

/**
 * Whether an event is about a machine's own resource: its type ends
 * `{domain}.{resource}.{event}` with the machine's domain and object, which is
 * how every event is named. A state's type prefix, if any, comes before.
 *
 * @param {string} type - The event type a subscription names
 * @param {string} domain - The machine's domain
 * @param {string} object - The machine's object, a schema name
 * @returns {boolean}
 */
function aboutOwnResource(type, domain, object) {
  const parts = String(type ?? '').split('.');
  if (parts.length < 3 || !domain || !object) return false;
  const [eventDomain, resource] = parts.slice(-3);
  return eventDomain === domain && resource === snakeCase(object);
}

/**
 * Whether a value expression or CEL condition reads the record a step acts
 * on: `$object…` in a value expression, `object.…` in CEL.
 *
 * @param {string} str
 * @returns {boolean}
 */
function readsObject(str) {
  return /\$object\b/.test(str) || /(^|[^$\w.])object\./.test(str);
}

// =============================================================================
// Within-file validation (no resolved specs needed)
// =============================================================================

/**
 * Check guard clauses: every actor a declared role, every condition a declared
 * guard. Shared by actions and governed resources, which take the same clauses.
 *
 * @param {object[]|undefined} guards
 * @param {string} path - Where the clauses are, for the error
 * @param {Set<string>} validRoles
 * @param {Set<string>} guardIds
 * @returns {Array<{rule, message, path}>}
 */
function checkGuardClauses(guards, path, validRoles, guardIds) {
  const errors = [];
  for (const guard of (guards || [])) {
    for (const actor of (guard.actors || [])) {
      if (!validRoles.has(actor)) {
        // Usually a missing overlay, not a broken contract: a contract set adds
        // its roles by overlaying RoleType, and a package's contracts need the
        // package's own overlays applied.
        errors.push({
          rule: 'invalid-actor-role',
          message: `Actor role "${actor}" isn't in RoleType, which has: ${[...validRoles].join(', ')}. Roles beyond these are added by an overlay on RoleType in base/schemas/enums.yaml; contracts from a package need that package's own overlays applied (--overlay=<package>/src/overlays, before your own).`,
          path,
        });
      }
    }
    for (const condId of extractConditionIds(guard.conditions)) {
      if (!guardIds.has(condId)) {
        errors.push({ rule: 'unknown-guard', message: `Guard condition "${condId}" is not declared in this file or its extends chain`, path });
      }
    }
  }
  return errors;
}

/**
 * Validate within-file consistency of a state machine document.
 * @param {string} filePath - Path to the file (for loading extends)
 * @param {object} doc - Parsed YAML document
 * @returns {Array<{rule, message, path}>}
 */
/**
 * The event ids a step list sends by short name, at any depth.
 *
 * @param {object[]} steps - Authored steps
 * @returns {string[]}
 */
function emitsIn(steps) {
  const out = [];
  for (const step of everyStep(steps)) {
    if (typeof step.emit === 'string') out.push({ event: step.emit });
    else if (step.emit?.event) out.push({ event: step.emit.event, data: step.emit.data });
  }
  return out;
}

/**
 * What's wrong with the data an emit step sends, against the schema its event
 * declares: a property the schema requires that the step doesn't send; one it
 * sends that the schema doesn't declare, when the schema allows no others; or
 * data at all, when the event declares no schema and so carries none. The
 * values are runtime expressions, so only the property names are checked.
 *
 * @param {{ event: string, data?: object }} emit
 * @param {{ schema?: object }} declared - The event, as the machine's emits declares it
 * @returns {string[]} Messages
 */
function emitDataProblems(emit, declared) {
  const sent = emit.data && typeof emit.data === 'object' ? Object.keys(emit.data) : [];
  const schema = declared.schema;
  if (!schema) {
    return sent.length ? [`emit "${emit.event}" sends data (${sent.join(', ')}), but the event declares no schema, so it carries none. Declare the data under its schema in emits.`] : [];
  }
  const problems = [];
  const missing = (schema.required || []).filter((name) => !sent.includes(name));
  if (missing.length) problems.push(`emit "${emit.event}" doesn't send ${missing.join(', ')}, which its schema requires.`);
  if (schema.additionalProperties === false) {
    const undeclared = sent.filter((name) => !Object.hasOwn(schema.properties || {}, name));
    if (undeclared.length) problems.push(`emit "${emit.event}" sends ${undeclared.join(', ')}, which its schema doesn't declare.`);
  }
  return problems;
}

export function validateWithinFile(filePath, doc, { validRoles = VALID_ACTOR_ROLES } = {}) {
  const errors = [];
  if (!doc || typeof doc !== 'object') return errors;

  const guardIds = collectGuardIds(doc, filePath);

  for (const machine of (doc.machines || [])) {
    const ctx = `machines[${machine.object ?? '?'}]`;
    const stateIds = new Set((machine.states || []).map(s => s?.id).filter(Boolean));
    const callableIds = collectCallableIds(doc, machine, filePath);

    // No duplicate state IDs
    const seenStates = new Set();
    for (const s of (machine.states || [])) {
      if (s?.id) {
        if (seenStates.has(s.id)) errors.push({ rule: 'duplicate-id', message: `Duplicate state id "${s.id}"`, path: `${ctx}.states` });
        seenStates.add(s.id);
      }
    }

    // `events:` was renamed; a machine still declaring it would react to nothing.
    if (machine.events !== undefined) {
      errors.push({ rule: 'renamed-key', message: '`events:` is now `on:` — the events this machine reacts to.', path: `${ctx}.events` });
    }

    // Every event a step sends by id is one the machine declares under emits,
    // and the data it sends fits the schema the event declares.
    const emitted = new Map();
    for (const e of (machine.emits || [])) {
      if (!e?.id) continue;
      if (emitted.has(e.id)) errors.push({ rule: 'duplicate-id', message: `Duplicate emitted event id "${e.id}"`, path: `${ctx}.emits` });
      emitted.set(e.id, e);
    }
    for (const [key, holders] of [['actions', machine.actions], ['on', machine.on], ['procedures', machine.procedures]]) {
      for (const holder of holders || []) {
        for (const emit of emitsIn(holder?.steps)) {
          const name = emit.event;
          if (emitted.has(name)) {
            for (const message of emitDataProblems(emit, emitted.get(name))) {
              errors.push({ rule: 'emit-data', message, path: `${ctx}.${key}[${holder.id ?? holder.type ?? '?'}]` });
            }
          } else {
            errors.push({
              rule: 'undeclared-emit',
              message: `emit "${name}" is not an event the ${machine.object} machine declares under emits` +
                (emitted.size ? ` (declared: ${[...emitted.keys()].join(', ')})` : ', which declares none') + '.',
              path: `${ctx}.${key}[${holder.id ?? holder.type ?? '?'}]`,
            });
          }
        }
      }
    }

    // No duplicate action IDs
    const seenActions = new Set();
    for (const a of (machine.actions || [])) {
      if (a?.id) {
        if (seenActions.has(a.id)) errors.push({ rule: 'duplicate-id', message: `Duplicate action id "${a.id}"`, path: `${ctx}.actions` });
        seenActions.add(a.id);
      }
    }

    // No duplicate procedure IDs
    const seenProcs = new Set();
    for (const p of (machine.procedures || [])) {
      if (p?.id) {
        if (seenProcs.has(p.id)) errors.push({ rule: 'duplicate-id', message: `Duplicate procedure id "${p.id}"`, path: `${ctx}.procedures` });
        seenProcs.add(p.id);
      }
    }

    // No duplicate guard IDs in this machine
    const seenMachineGuards = new Set();
    for (const g of (machine.guards || [])) {
      if (g?.id) {
        if (seenMachineGuards.has(g.id)) errors.push({ rule: 'duplicate-id', message: `Duplicate guard id "${g.id}"`, path: `${ctx}.guards` });
        seenMachineGuards.add(g.id);
      }
    }

    // Validate actions
    for (const action of (machine.actions || [])) {
      const ap = `${ctx}.actions[${action.id ?? '?'}]`;
      const tr = action.transition;
      if (tr) {
        const froms = Array.isArray(tr.from) ? tr.from : (tr.from != null ? [tr.from] : []);
        const tos = Array.isArray(tr.to) ? tr.to : (tr.to != null ? [tr.to] : []);
        for (const f of froms) {
          if (f !== '*' && !stateIds.has(f)) {
            errors.push({ rule: 'unknown-state', message: `Transition from unknown state "${f}"`, path: `${ap}.transition.from` });
          }
        }
        for (const t of tos) {
          if (t !== '*' && !stateIds.has(t)) {
            errors.push({ rule: 'unknown-state', message: `Transition to unknown state "${t}"`, path: `${ap}.transition.to` });
          }
        }
      }

      errors.push(...checkGuardClauses(action.guards, `${ap}.guards`, validRoles, guardIds));

      for (const callId of walkCallStrings(action.steps)) {
        if (!callableIds.has(callId)) {
          errors.push({ rule: 'unknown-callable', message: `call: "${callId}" references undeclared procedure or action`, path: `${ap}.steps` });
        }
      }
      for (const step of walkUnreachableFailures(action.steps)) errors.push(...unreachableFailure(step, `${ap}.steps`));
    }

    // A governed resource's guards are checked as an action's are.
    for (const [name, governed] of Object.entries(machine.resources || {})) {
      for (const operation of ['create', 'update']) {
        errors.push(...checkGuardClauses(governed?.[operation]?.guards, `${ctx}.resources[${name}].${operation}.guards`, validRoles, guardIds));
      }
    }

    // Validate events
    for (const event of (machine.on || [])) {
      const ep = `${ctx}.on[${event.type ?? '?'}]`;
      for (const callId of walkCallStrings(event.steps)) {
        if (!callableIds.has(callId)) {
          errors.push({ rule: 'unknown-callable', message: `call: "${callId}" references undeclared procedure or action`, path: ep });
        }
      }
      for (const step of walkUnreachableFailures(event.steps)) errors.push(...unreachableFailure(step, ep));
      // With transition:, the event's subject is one of this machine's records,
      // looked up as $object. Without it, an event about another resource gives
      // the machine no record of its own, so there is no $object: the record
      // the event is about is its subject, and what it carries is its data.
      if (!event.transition && !aboutOwnResource(event.type, doc.domain, machine.object)
          && [...walkAllStrings([event.steps, event.context])].some(readsObject)) {
        errors.push({
          rule: 'object-from-another-resource',
          message: `${event.type} is about another resource, so this machine has no $object here. Read the id of the record the event is about from $this.subject, and what the event carries from $this.data.`,
          path: ep,
        });
      }
    }

    // Validate procedures
    for (const proc of (machine.procedures || [])) {
      const pp = `${ctx}.procedures[${proc.id ?? '?'}]`;
      const paramNames = new Set(proc.parameters || []);

      // $params.X must match declared parameters
      const procStrings = [
        ...walkAllStrings(proc.if),
        ...walkAllStrings(proc.then),
        ...walkAllStrings(proc.steps),
        ...walkAllStrings(proc.context),
      ];
      for (const str of procStrings) {
        for (const { variable, field } of extractFieldRefs(str)) {
          if (variable === 'params') {
            const topLevel = field.split('.')[0];
            if (!paramNames.has(topLevel)) {
              errors.push({ rule: 'unknown-param', message: `$params.${field} references undeclared parameter "${topLevel}"`, path: pp });
            }
          }
        }
      }

      const procSteps = [...(proc.steps || []), ...(proc.then || [])];
      // A procedure of one step is that step, written on the procedure.
      for (const step of walkUnreachableFailures(proc.steps || proc.then ? procSteps : [proc])) {
        errors.push(...unreachableFailure(step, pp));
      }
      for (const callId of walkCallStrings(procSteps)) {
        if (!callableIds.has(callId)) {
          errors.push({ rule: 'unknown-callable', message: `call: "${callId}" references undeclared procedure or action`, path: pp });
        }
      }
    }
  }

  return errors;
}

// =============================================================================
// Cross-artifact validation (requires resolved specs)
// =============================================================================

/**
 * Validate cross-artifact field references in a state machine document.
 * @param {string} filePath - Path to the file (for error messages)
 * @param {object} doc - Parsed YAML document
 * @param {Map} schemaIndex - From buildSchemaIndex() in indexes.js
 * @param {Map} endpointIndex - From buildCollectionIndex()
 * @param {Object} [exceptions]
 * @param {ReturnType<import('../operations.js').readOperations>} [operations] - The
 *   set's, from extract(docs, 'operations'); null skips checking calls to operations
 * @returns {Array<{rule, message, path}>}
 */
export function validateCrossArtifact(filePath, doc, schemaIndex, endpointIndex, exceptions = {}, operations = null) {
  const exceptedFields = new Set(
    (exceptions.unknownFields || []).map(e => `${e.schema}:${e.field}`)
  );
  const errors = [];
  if (!doc || typeof doc !== 'object') return errors;

  for (const machine of (doc.machines || [])) {
    const ctx = `machines[${machine.object ?? '?'}]`;

    // Machine object: name must exist as a schema
    const objectEntry = machine.object ? schemaIndex.get(machine.object) : null;
    if (machine.object && !objectEntry) {
      errors.push({ rule: 'unknown-object', message: `Machine object "${machine.object}" not found in any OpenAPI spec`, path: `${ctx}.object` });
      continue;
    }

    // Build a union of all context bindings across the machine for field ref validation.
    // All procedures can see all event contexts (since procedures are called from event handlers).
    const allContextEntries = new Map(); // varName → { fromPath, schemaEntry }

    if (objectEntry) {
      allContextEntries.set('object', { fromPath: machine.object, schemaEntry: objectEntry });
    }

    function registerContext(contextArray, locationPath) {
      for (const [varName, fromPath] of collectContextBindings(contextArray)) {
        if (!endpointIndex.has(fromPath)) {
          errors.push({ rule: 'unknown-endpoint', message: `Context "${varName}" from: "${fromPath}" does not resolve to a known endpoint`, path: locationPath });
        }
        const schemaName = endpointIndex.get(fromPath);
        const schemaEntry = schemaName ? schemaIndex.get(schemaName) : null;
        allContextEntries.set(varName, { fromPath, schemaEntry });
      }
    }

    for (const action of (machine.actions || [])) {
      registerContext(action.context, `${ctx}.actions[${action.id}].context`);
    }
    for (const event of (machine.on || [])) {
      registerContext(event.context, `${ctx}.on[${event.type}].context`);
    }
    for (const proc of (machine.procedures || [])) {
      registerContext(proc.context, `${ctx}.procedures[${proc.id}].context`);
    }

    // A transition on an event about another resource applies to this
    // machine's records that name the event's subject, so exactly one field
    // must relate them: through it, the engine finds which records.
    if (objectEntry) {
      for (const event of (machine.on || [])) {
        if (!event.transition || aboutOwnResource(event.type, doc.domain, machine.object)) continue;
        const parts = String(event.type ?? '').split('.');
        if (parts.length < 3) continue;
        const eventObject = parts[parts.length - 2];
        const named = [...schemaIndex.keys()].find((name) => snakeCase(name) === eventObject);
        const relating = [...objectEntry.properties]
          .filter(([, property]) => named && property?.['x-relationship']?.resource === named)
          .map(([field]) => field);
        if (relating.length !== 1) {
          errors.push({
            rule: 'transition-on-unrelated-event',
            message: relating.length === 0
              ? `${event.type} is about ${named ?? `"${eventObject}"`}, and no field of ${machine.object} relates to it, so there's no record to transition. Declare the field with x-relationship, or drop transition: and work from $this.subject.`
              : `${event.type} is about ${named}, and ${machine.object} relates to it through ${relating.join(' and ')}, so which records to transition is ambiguous.`,
            path: `${ctx}.on[${event.type}].transition`,
          });
        }
      }
    }

    // Validate set: {field:} targets exist on object schema
    if (objectEntry) {
      for (const action of (machine.actions || [])) {
        for (const fieldName of walkSetFields(action.steps)) {
          if (!objectEntry.properties.has(fieldName) && !exceptedFields.has(`${machine.object}:${fieldName}`)) {
            errors.push({
              rule: 'unknown-set-field',
              message: `set: field "${fieldName}" does not exist on ${machine.object} schema`,
              path: `${ctx}.actions[${action.id}].steps`
            });
          }
        }
      }
    }

    // Validate $variable.field references and enum comparisons across all strings in the machine
    const allStrings = [...walkAllStrings(machine)];

    for (const str of allStrings) {
      // Field references: check first segment exists on the schema
      for (const { variable, field } of extractFieldRefs(str)) {
        if (SYSTEM_VARIABLES.has(variable)) continue;

        const entry = allContextEntries.get(variable);
        if (!entry) continue; // Unknown variable (loop var, etc.) — skip
        if (!entry.schemaEntry) continue; // Endpoint known but no schema

        const topField = field.split('.')[0];
        const schemaName = endpointIndex.get(entry.fromPath) ?? entry.fromPath;
        if (!entry.schemaEntry.properties.has(topField) && !exceptedFields.has(`${schemaName}:${topField}`)) {
          errors.push({
            rule: 'unknown-field',
            message: `$${variable}.${topField} does not exist on the schema bound to "${variable}" (from ${entry.fromPath})`,
            path: ctx
          });
        }
      }

      // Enum comparisons: check the literal value is a valid enum value for the field
      for (const { value, variable, field } of extractEnumComparisons(str)) {
        if (SYSTEM_VARIABLES.has(variable)) continue;
        const entry = allContextEntries.get(variable);
        if (!entry?.schemaEntry) continue;

        const fieldSchema = getPropertyAtPath(entry.schemaEntry.spec, entry.schemaEntry.schema, field);
        if (!fieldSchema) continue; // Field not found — already caught above

        const enumValues = fieldSchema.enum || fieldSchema.items?.enum;
        if (enumValues && !enumValues.includes(value)) {
          errors.push({
            rule: 'invalid-enum-value',
            message: `"${value}" is not a valid enum value for $${variable}.${field} (valid: ${enumValues.join(', ')})`,
            path: ctx
          });
        }
      }
    }

    // Validate call: {METHOD: path} — strip template vars and check against endpoint index
    function validateCallPaths(steps, locationPath) {
      for (const { method, callPath } of walkObjectCalls(steps)) {
        // Strip $variable references to get static path segments
        const staticPath = callPath
          .replace(/\$[a-zA-Z_][a-zA-Z0-9_.]*(?=\/|$)/g, '')
          .replace(/\/+/g, '/')
          .replace(/\/$/, '')
          .replace(/^\//, '');

        const parts = staticPath.split('/').filter(p => p && !p.startsWith('{'));
        if (parts.length < 2) continue; // Can't validate single-segment paths

        const endpointKey = parts.join('/');
        const known = endpointIndex.has(endpointKey) ||
          [...endpointIndex.keys()].some(k => k === endpointKey || k.startsWith(endpointKey + '/') || endpointKey.startsWith(k + '/'));
        if (!known) {
          errors.push({
            rule: 'unknown-call-path',
            message: `call: {${method}: "${callPath}"} — "${endpointKey}" does not resolve to a known endpoint`,
            path: locationPath
          });
        }
      }
    }

    // A call to an operation names one the set has — one a capability the
    // set hasn't listed is named as such, by validate — and only one: an id
    // two APIs declare is qualified by the API it means.
    function validateOperationCalls(steps, locationPath) {
      if (!operations) return;
      for (const ref of new Set(walkOperationCalls(steps))) {
        const { candidates } = operations.find(ref);
        if (candidates.length === 0) {
          errors.push({ rule: 'unknown-operation', message: `call: operationId "${ref}" names no operation in the set.`, path: locationPath });
        } else if (candidates.length > 1) {
          errors.push({
            rule: 'ambiguous-operation',
            message: `call: operationId "${ref}" is declared by more than one API; write ${candidates.map(qualifiedRef).join(' or ')}.`,
            path: locationPath,
          });
        }
      }
    }

    for (const action of (machine.actions || [])) {
      validateCallPaths(action.steps, `${ctx}.actions[${action.id}].steps`);
      validateOperationCalls(action.steps, `${ctx}.actions[${action.id}].steps`);
    }
    for (const event of (machine.on || [])) {
      validateCallPaths(event.steps, `${ctx}.on[${event.type}].steps`);
      validateOperationCalls(event.steps, `${ctx}.on[${event.type}].steps`);
    }
    for (const proc of (machine.procedures || [])) {
      const procSteps = [...(proc.steps || []), ...(proc.then || [])];
      validateCallPaths(procSteps, `${ctx}.procedures[${proc.id}]`);
      validateOperationCalls(procSteps.length ? procSteps : [proc], `${ctx}.procedures[${proc.id}]`);
    }

    // Validate literal $push body field values against the target array's items schema enum.
    const allMachineSteps = [
      ...(machine.actions || []).flatMap(a => a.steps || []),
      ...(machine.on || []).flatMap(e => e.steps || []),
      ...(machine.procedures || []).flatMap(p => [...(p.steps || []), ...(p.then || [])]),
    ];

    for (const { method, callPath, bodyField, pushBody } of walkPushBodiesInCalls(allMachineSteps)) {
      const staticPath = callPath
        .replace(/\$[a-zA-Z_][a-zA-Z0-9_.]*(?=\/|$)/g, '')
        .replace(/\/+/g, '/')
        .replace(/\/$/, '')
        .replace(/^\//, '');
      const parts = staticPath.split('/').filter(p => p && !p.startsWith('{'));
      if (parts.length < 2) continue;
      const endpointKey = parts.join('/');

      const pushSchemaName = endpointIndex.get(endpointKey);
      if (!pushSchemaName) continue;
      const pushSchemaEntry = schemaIndex.get(pushSchemaName);
      if (!pushSchemaEntry) continue;

      const arrayFieldSchema = getPropertyAtPath(pushSchemaEntry.spec, pushSchemaEntry.schema, bodyField);
      if (!arrayFieldSchema?.items) continue;

      let itemsSchema = arrayFieldSchema.items;
      if (itemsSchema.$ref) itemsSchema = resolveRef(pushSchemaEntry.spec, itemsSchema.$ref) ?? itemsSchema;
      // An item that is one of several shapes allows what any of them allows.
      const shapes = (itemsSchema.oneOf ?? itemsSchema.anyOf ?? [itemsSchema])
        .map((shape) => (shape.$ref ? resolveRef(pushSchemaEntry.spec, shape.$ref) ?? shape : shape));

      const locationPath = `${ctx} (${method} ${callPath}, requestBody.payload.${bodyField}.$push)`;

      for (const [pushField, pushVal] of Object.entries(pushBody)) {
        if (typeof pushVal !== 'string') continue;

        const fieldSchemas = shapes
          .map((shape) => getPropertyAtPath(pushSchemaEntry.spec, shape, pushField))
          .filter(Boolean);
        // A shape that takes the field without an enum takes any value.
        if (fieldSchemas.length === 0 || fieldSchemas.some((field) => !field.enum)) continue;
        const enumValues = [...new Set(fieldSchemas.flatMap((field) => field.enum))];

        // A variable's value isn't known until the step runs.
        if (pushVal.startsWith('$')) continue;
        if (!enumValues.includes(pushVal)) {
          errors.push({
            rule: 'invalid-push-enum-value',
            message: `"${pushVal}" is not a valid enum value for ${bodyField}[].${pushField} (valid: ${enumValues.join(', ')})`,
            path: locationPath,
          });
        }
      }
    }
  }

  return errors;
}

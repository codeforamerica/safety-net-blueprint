/**
 * parse-scenario.js
 *
 * Parses a Postman v2.1 scenario collection into a structured representation
 * usable by both the service blueprint and sequence diagram renderers.
 *
 * Derives:
 *   - Phases from top-level folders (item[].name where item has children)
 *   - Steps from requests inside folders
 *   - Called domain from URL path (/intake/... → intake)
 *   - Actors from state machine guards matched by URL pattern
 *   - Event type from POST /platform/events body
 *   - Verification steps (GET requests — test assertions, not business steps)
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(__dirname, '..', '..', '..', 'contracts');

function getVar(variables, key) {
  return (variables || []).find(v => v.key === key)?.value ?? '';
}

function isHidden(item) {
  const prereq = (item.event || []).find(e => e.listen === 'prerequest');
  return (prereq?.script?.exec || []).some(line => line.includes('x-diagram: hide'));
}

function stripBaseUrl(rawUrl) {
  return rawUrl
    .replace(/^https?:\/\/[^/]+/, '') // strip http://hostname
    .replace(/^\{\{[^}]+\}\}/, '');   // strip leading {{variable}}
}

function extractDomain(rawUrl) {
  const path = stripBaseUrl(rawUrl).replace(/\{\{[^}]+\}\}/g, '{id}');
  const segments = path.split('/').filter(Boolean);
  return (segments[0] || 'unknown').replace(/-/g, '_');
}

function normalizePath(rawUrl) {
  return stripBaseUrl(rawUrl)
    .replace(/\{\{[^}]+\}\}/g, '{id}')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/{id}')
    .replace(/^\/([^/]+)/, (_, seg) => '/' + seg.replace(/-/g, '_'));
}

// Build eventType → [subscriberDomains] from state machine event subscription sections
export function buildEventSubscriptionMap() {
  const map = new Map();
  if (!existsSync(contractsDir)) return map;

  for (const f of readdirSync(contractsDir)) {
    if (!f.endsWith('-state-machine.yaml')) continue;
    const domain = f.replace('-state-machine.yaml', '');
    try {
      const sm = yaml.load(readFileSync(join(contractsDir, f), 'utf8'));
      for (const machine of (sm.machines || [])) {
        for (const event of (machine.events || [])) {
          if (!event.type) continue;
          if (!map.has(event.type)) map.set(event.type, []);
          if (!map.get(event.type).includes(domain)) map.get(event.type).push(domain);
        }
      }
    } catch { /* skip unreadable files */ }
  }
  return map;
}

// Derive annotation key from a URL path: last two non-variable segments → entity.action
// e.g. /applications/{id}/submit → application.submit
// e.g. /applications/{id}/verifications/{id}/satisfy → verification.satisfy
function deriveAnnotationKey(actionPath) {
  const segs = actionPath.split('/').filter(s => s && !s.startsWith('{'));
  if (segs.length < 2) return null;
  const action = segs[segs.length - 1];
  const entity = segs[segs.length - 2].replace(/s$/, '');
  return `${entity}.${action}`;
}

// Build METHOD:"/domain/path" → annotationKey from state machine action descriptions
function buildUrlAnnotationKeyMap() {
  const map = new Map();
  if (!existsSync(contractsDir)) return map;
  for (const f of readdirSync(contractsDir)) {
    if (!f.endsWith('-state-machine.yaml')) continue;
    const smDomain = f.replace('-state-machine.yaml', '');
    try {
      const sm = yaml.load(readFileSync(join(contractsDir, f), 'utf8'));
      for (const machine of (sm.machines || [])) {
        for (const action of (machine.actions || [])) {
          const desc = action.description || '';
          const match = desc.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\/\S+)/i);
          if (!match) continue;
          const key = deriveAnnotationKey(match[2]);
          if (!key) continue;
          const fullPath = `/${smDomain}${match[2]}`.replace(/\{[^}]+\}/g, '{id}');
          map.set(`${match[1].toUpperCase()}:${fullPath}`, key);
        }
      }
    } catch { /* skip */ }
  }
  return map;
}

// Load operations and events annotation sections from all {domain}-annotations*.yaml files
function loadAllAnnotations() {
  const merged = { operations: {}, events: {} };
  if (!existsSync(contractsDir)) return merged;
  for (const f of readdirSync(contractsDir)) {
    if (!f.match(/-annotations.*\.yaml$/)) continue;
    try {
      const data = yaml.load(readFileSync(join(contractsDir, f), 'utf8'));
      Object.assign(merged.operations, data.operations || {});
      Object.assign(merged.events, data.events || {});
    } catch { /* skip */ }
  }
  return merged;
}

// Load policyId → {citation, citationUrl} from platform-registry-policies.yaml
function loadPolicyRegistry() {
  const path = join(contractsDir, 'platform-registry-policies.yaml');
  if (!existsSync(path)) return {};
  try { return yaml.load(readFileSync(path, 'utf8')).policies || {}; }
  catch { return {}; }
}

function resolvePolicies(ids, registry) {
  return (ids || []).map(id => registry[id]).filter(Boolean)
    .map(p => ({ citation: p.citation, citationUrl: p.citationUrl, description: p.description?.trim() || undefined }));
}

// Build METHOD:"/domain/path-pattern" → [actors] from state machine descriptions
export function buildUrlActorMap() {
  const map = new Map();
  if (!existsSync(contractsDir)) return map;

  for (const f of readdirSync(contractsDir)) {
    if (!f.endsWith('-state-machine.yaml')) continue;
    const smDomain = f.replace('-state-machine.yaml', '');
    try {
      const sm = yaml.load(readFileSync(join(contractsDir, f), 'utf8'));
      for (const machine of (sm.machines || [])) {
        for (const action of (machine.actions || [])) {
          const desc = action.description || '';
          const match = desc.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\/\S+)/i);
          if (!match) continue;
          const method = match[1].toUpperCase();
          const path = `/${smDomain}${match[2]}`;
          const actors = [];
          for (const guard of (action.guards || [])) {
            if (guard.actors?.length > 0) { actors.push(...guard.actors); break; }
          }
          const normalizedPath = path.replace(/\{[^}]+\}/g, '{id}');
          if (actors.length > 0) map.set(`${method}:${normalizedPath}`, actors);
        }
      }
    } catch { /* skip unreadable files */ }
  }
  return map;
}

// Derive a domain key from a folder name, e.g. "workflow branch" → "workflow"
function inferDomainFromName(name) {
  return name.toLowerCase().replace(/\s+branch$/i, '').replace(/\s+/g, '_').trim();
}

// branchDomain: set when this item lives inside a named par-branch sub-folder.
// Steps in a branch that call a different domain are tagged isCrossDomainCall so the
// renderer can draw the arrow in the right direction.
function parseItem(item, phaseName, urlActorMap, branchDomain = null) {
  const steps = [];
  if (isHidden(item)) return steps;

  if (item.item) {
    const subFolders = item.item.filter(c => c.item);
    if (subFolders.length > 0) {
      // Par container: folder has sub-folder branches.
      // Direct (non-folder) children are preamble steps; sub-folders are par branches.
      for (const child of item.item) {
        if (child.item) {
          const domain = inferDomainFromName(child.name);
          for (const grandchild of child.item) {
            steps.push(...parseItem(grandchild, phaseName, urlActorMap, domain));
          }
        } else {
          steps.push(...parseItem(child, phaseName, urlActorMap, null));
        }
      }
    } else {
      for (const child of item.item) {
        steps.push(...parseItem(child, phaseName, urlActorMap, branchDomain));
      }
    }
    return steps;
  }

  const req = item.request;
  if (!req) return steps;

  const method = (req.method || 'GET').toUpperCase();
  const rawUrl = typeof req.url === 'string' ? req.url : (req.url?.raw || '');
  const domain = extractDomain(rawUrl);
  const normalized = normalizePath(rawUrl);
  let actors = urlActorMap.get(`${method}:${normalized}`) || [];
  if (actors.length === 0) {
    const callerHeader = (req.header || []).find(h => h.key === 'X-Caller-Roles');
    if (callerHeader?.value) actors = callerHeader.value.split(',').map(r => r.trim());
  }

  let event = null;
  let eventSource = null;
  if (domain === 'platform' && method === 'POST') {
    try {
      const body = JSON.parse(req.body?.raw || '{}');
      event = body.type || null;
      if (event) eventSource = event.split('.')[0] || null;
    } catch { /* non-JSON body */ }
  }

  // Detect emission assertions: GET /platform/events?type=<event.type>
  // These verify that a domain emitted an event and serve as emission arcs in the diagram.
  // When a `traceid` param is also present, the step is a causal chain assertion — it verifies
  // an event that was caused by a prior emission (linked via W3C traceparent traceId).
  let emittedEvent = null;
  let emittedEventSource = null;
  let isCausalChain = false;
  if (domain === 'platform' && method === 'GET') {
    const queryParams = typeof req.url === 'object' ? (req.url.query || []) : [];
    const typeParam   = queryParams.find(q => q.key === 'type');
    const traceidParam = queryParams.find(q => q.key === 'traceid');
    if (typeParam?.value) {
      emittedEvent = typeParam.value;
      emittedEventSource = emittedEvent.split('.')[0] || null;
      isCausalChain = !!traceidParam;
    }
  }

  // Detect reaction assertions: GET /{non-platform-domain}/... with a traceid param.
  // These verify that a subscriber acted on an event — e.g. workflow created a task,
  // eligibility created a determination — and render as self-directed action arrows
  // on that domain's lifeline in the sequence diagram.
  let isReactionAssertion = false;
  if (domain !== 'platform' && method === 'GET') {
    const queryParams = typeof req.url === 'object' ? (req.url.query || []) : [];
    isReactionAssertion = queryParams.some(q => q.key === 'traceid');
  }

  // Within a named par branch: a write method to a different domain = that branch domain
  // is making a direct API call. Tag it so the renderer draws the arrow from the right place.
  let isCrossDomainCall = false;
  let isCrossDomainReturn = false;
  let fromDomain = null;
  let toDomain = null;
  if (branchDomain && domain !== 'platform' && domain !== branchDomain
      && !isReactionAssertion && !emittedEvent
      && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    isCrossDomainCall = true;
    fromDomain = branchDomain;
    toDomain = domain;
  } else if (branchDomain && domain === 'platform' && method === 'POST'
             && event && eventSource && eventSource !== branchDomain) {
    // Event injection in a branch where the event source differs from the branch =
    // the result/response arriving back from the called domain. Render as a return arrow.
    isCrossDomainReturn = true;
    fromDomain = eventSource;
    toDomain = branchDomain;
  }

  steps.push({
    name: item.name,
    description: item.request?.description || item.description || null,
    method,
    url: rawUrl,
    normalizedPath: normalized,
    domain,
    actors,
    event,
    eventSource,
    emittedEvent,
    emittedEventSource,
    isCausalChain,
    isReactionAssertion,
    isCrossDomainCall,
    isCrossDomainReturn,
    fromDomain,
    toDomain,
    phase: phaseName,
    isVerification: method === 'GET' && !isReactionAssertion,
    policies: [],
  });

  return steps;
}

// Build a single blueprint-visible step from a request item.
// Includes:
//   - GET /platform/events assertions  → system action (the emitting domain did this)
//   - POST/PUT/PATCH/DELETE to business domains → people or system action
// Excludes:
//   - POST /platform/events injections → test stubs, not real system actions
//   - GET to non-platform domains → test verifications of state
//   - Hidden items
function buildBlueprintStep(item, urlActorMap, urlAnnotationKeyMap, annotations, policyRegistry) {
  if (isHidden(item)) return null;
  const req = item.request;
  if (!req) return null;

  const method = (req.method || 'GET').toUpperCase();
  const rawUrl = typeof req.url === 'string' ? req.url : (req.url?.raw || '');
  const domain = extractDomain(rawUrl);
  const normalized = normalizePath(rawUrl);
  const qp = typeof req.url === 'object' ? (req.url.query || []) : [];

  let displayDomain, actors = [], event = null;

  if (domain === 'platform') {
    if (method === 'POST') return null;  // event injections are test stubs — skip
    if (method !== 'GET') return null;
    const typeParam = qp.find(q => q.key === 'type');
    if (!typeParam?.value) return null;
    event = typeParam.value;
    displayDomain = event.split('.')[0].replace(/-/g, '_');
  } else if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    displayDomain = domain;
    // Prefer the actual caller role from the test request (scenario-specific)
    // over the full actor list from the state machine (all possible actors).
    const callerHeader = (req.header || []).find(h => h.key === 'X-Caller-Roles');
    if (callerHeader?.value) {
      actors = callerHeader.value.split(',').map(r => r.trim());
    } else {
      actors = urlActorMap.get(`${method}:${normalized}`) || [];
    }
  } else {
    return null;  // GET to non-platform domain — test assertion, skip
  }

  let policyIds = [];
  if (event) {
    policyIds = annotations.events[event]?.policies || [];
  } else {
    const annKey = urlAnnotationKeyMap.get(`${method}:${normalized}`);
    if (annKey) policyIds = annotations.operations[annKey]?.policies || [];
  }

  return {
    name: item.name,
    displayDomain,
    actors,
    event,
    policies: resolvePolicies(policyIds, policyRegistry),
  };
}

// Flatten all blueprint-visible steps from a list of items, recursing into sub-folders.
function flattenBlueprintSteps(items, urlActorMap, urlAnnotationKeyMap, annotations, policyRegistry) {
  const steps = [];
  for (const item of items) {
    if (isHidden(item)) continue;
    if (item.item) {
      steps.push(...flattenBlueprintSteps(item.item, urlActorMap, urlAnnotationKeyMap, annotations, policyRegistry));
    } else {
      const step = buildBlueprintStep(item, urlActorMap, urlAnnotationKeyMap, annotations, policyRegistry);
      if (step) steps.push(step);
    }
  }
  return steps;
}

// Build the flat column list for the service blueprint.
// Each column is { phase, subPhase, steps }.
// Top-level folders → phases; nested folders within them → sub-phases.
function buildColumns(collection, urlActorMap, urlAnnotationKeyMap, annotations, policyRegistry) {
  const columns = [];

  for (const topFolder of (collection.item || [])) {
    if (!topFolder.item || isHidden(topFolder)) continue;

    const subFolders = topFolder.item.filter(c => c.item && !isHidden(c));
    const directItems = topFolder.item.filter(c => !c.item);

    if (subFolders.length === 0) {
      const steps = flattenBlueprintSteps(topFolder.item, urlActorMap, urlAnnotationKeyMap, annotations, policyRegistry);
      if (steps.length > 0) columns.push({ phase: topFolder.name, subPhase: null, steps });
    } else {
      // Direct (non-folder) items at the phase level
      const directSteps = directItems
        .filter(c => !isHidden(c))
        .map(c => buildBlueprintStep(c, urlActorMap, urlAnnotationKeyMap, annotations, policyRegistry))
        .filter(Boolean);
      if (directSteps.length > 0) columns.push({ phase: topFolder.name, subPhase: null, steps: directSteps });

      for (const sf of subFolders) {
        const steps = flattenBlueprintSteps(sf.item, urlActorMap, urlAnnotationKeyMap, annotations, policyRegistry);
        if (steps.length > 0) columns.push({ phase: topFolder.name, subPhase: sf.name, steps });
      }
    }
  }

  return columns;
}

export function parseScenario(filePath) {
  const collection = JSON.parse(readFileSync(filePath, 'utf8'));
  const urlActorMap = buildUrlActorMap();
  const urlAnnotationKeyMap = buildUrlAnnotationKeyMap();
  const annotations = loadAllAnnotations();
  const policyRegistry = loadPolicyRegistry();
  const eventSubscriptions = buildEventSubscriptionMap();

  const id = getVar(collection.variable, 'id');
  const domain = getVar(collection.variable, 'domain');
  const prereqs = JSON.parse(getVar(collection.variable, 'prereqs') || '[]');

  const phases = [];
  for (const item of (collection.item || [])) {
    if (!item.item) continue;
    const steps = [];
    for (const child of item.item) {
      steps.push(...parseItem(child, item.name, urlActorMap));
    }
    phases.push({ name: item.name, steps });
  }

  // Attach policies to each step from annotations + policy registry
  for (const phase of phases) {
    for (const step of phase.steps) {
      let ids = [];
      if (step.emittedEvent) {
        ids = annotations.events[step.emittedEvent]?.policies || [];
      } else {
        const annKey = urlAnnotationKeyMap.get(`${step.method}:${step.normalizedPath}`);
        if (annKey) ids = annotations.operations[annKey]?.policies || [];
      }
      step.policies = resolvePolicies(ids, policyRegistry);
    }
  }

  const allDomains = new Set();
  const allActors = new Set();
  for (const phase of phases) {
    for (const step of phase.steps) {
      if (!step.isVerification) {
        allDomains.add(step.domain);
        if (step.eventSource) allDomains.add(step.eventSource);
        for (const a of step.actors) allActors.add(a);
      }
      if (step.emittedEventSource) allDomains.add(step.emittedEventSource);
    }
  }

  const columns = buildColumns(collection, urlActorMap, urlAnnotationKeyMap, annotations, policyRegistry);

  return {
    id,
    domain,
    prereqs,
    name: collection.info.name,
    description: collection.info.description,
    phases,
    columns,
    domains: [...allDomains],
    actors: [...allActors],
    eventSubscriptions,
  };
}

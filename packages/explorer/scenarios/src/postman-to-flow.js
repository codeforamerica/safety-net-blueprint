/**
 * postman-to-flow.js
 *
 * Converts a Postman v2.1 collection into the flow object format expected by
 * renderFlowPage() in packages/explorer/context-map/src/render.js.
 *
 * Folder/item markers (place in pre-request script):
 *   // x-diagram: hide          — omit this folder or request from the diagram; or (on a folder) hide all request children by default
 *   // x-diagram: show          — (request) render this request even inside a hide folder
 *   // x-diagram: self          — render this folder/request as a self-loop on the current domain
 *   // x-diagram: self <domain> — render as a self-loop on the named domain (e.g. document_management)
 *   // x-diagram: gap           — force this request to render as a gap (overrides broken detection)
 *   // x-diagram: opt <label>   — render this folder as an opt fragment with the given condition label
 *   // x-diagram: to <domain>   — on an emission assertion: constrain the subscription arrow to only the named subscriber domain
 *
 * Top-level folders are automatically treated as sections (separator + inlined children) — no marker needed.
 *
 * Everything else is derived automatically:
 *   - GET /platform/events?type=X immediately before a par → auto-generates event delivery arrows
 *   - GET /platform/events?type=X elsewhere → self-loop, actor derived from event type prefix
 *   - POST /platform/events body.type → event step (from = event type prefix)
 *   - GET with ?traceid → reaction assertion → self-loop on the URL domain
 *   - POST/PUT/PATCH/DELETE → API call step (from derived from actor map or X-Caller-Roles header)
 *   - Structural requests (emission assertions, reaction assertions, event injections) always render
 *     regardless of the hide flag — only plain API calls are subject to hide/show
 *   - Participants inferred from step from/to/self values (actors before domains, first-appearance order)
 *   - Endpoints not defined in any *-openapi.yaml spec are automatically marked gap: true
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { buildUrlActorMap, buildEventSubscriptionMap } from './parse-scenario.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(__dirname, '..', '..', '..', 'contracts');

// Returns { defined: Set<"METHOD:/domain/path">, domainsWithPaths: Set<domainId> }
// An endpoint is a "gap" when the domain has no paths at all (API not yet designed).
// An endpoint is "broken" when the domain has paths but this specific one doesn't match.
function buildDefinedEndpoints() {
  const defined = new Set();
  const domainsWithPaths = new Set();
  if (!existsSync(contractsDir)) return { defined, domainsWithPaths };

  for (const f of readdirSync(contractsDir)) {
    if (f.endsWith('-openapi.yaml')) {
      try {
        const spec = yaml.load(readFileSync(join(contractsDir, f), 'utf8'));
        const domain = (spec.info?.['x-domain'] || '').replace(/-/g, '_');
        if (!domain) continue;
        const paths = Object.entries(spec.paths || {});
        if (paths.length > 0) domainsWithPaths.add(domain);
        for (const [path, methods] of paths) {
          const normalizedPath = path.replace(/\{[^}]+\}/g, '{id}');
          for (const method of Object.keys(methods)) {
            if (['get', 'post', 'put', 'patch', 'delete'].includes(method.toLowerCase())) {
              defined.add(`${method.toUpperCase()}:/${domain}${normalizedPath}`);
            }
          }
        }
      } catch { /* skip */ }
    } else if (f.endsWith('-state-machine.yaml')) {
      const smDomain = f.replace('-state-machine.yaml', '');
      try {
        const sm = yaml.load(readFileSync(join(contractsDir, f), 'utf8'));
        for (const machine of (sm.machines || [])) {
          for (const action of (machine.actions || [])) {
            const match = (action.description || '').match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\/\S+)/i);
            if (!match) continue;
            const path = `/${smDomain}${match[2]}`.replace(/\{[^}]+\}/g, '{id}');
            defined.add(`${match[1].toUpperCase()}:${path}`);
            domainsWithPaths.add(smDomain);
          }
        }
      } catch { /* skip */ }
    }
  }

  return { defined, domainsWithPaths };
}

function getVar(variables, key) {
  return (variables || []).find(v => v.key === key)?.value ?? '';
}

function getPrereqMarker(item, marker) {
  const prereq = (item.event || []).find(e => e.listen === 'prerequest');
  const line = (prereq?.script?.exec || []).find(l => l.includes(`x-diagram: ${marker}`));
  if (!line) return null;
  return line.replace(new RegExp(`.*x-diagram:\\s*${marker}\\s*`), '').trim();
}

function isHidden(item) {
  return getPrereqMarker(item, 'hide') !== null;
}

function isShown(item) {
  return getPrereqMarker(item, 'show') !== null;
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function rawUrl(req) {
  return typeof req.url === 'string' ? req.url : (req.url?.raw || '');
}

function queryParams(req) {
  return typeof req.url === 'object' ? (req.url.query || []) : [];
}

function extractDomain(url) {
  const path = (typeof url === 'string' ? url : url?.raw || '')
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/^\{\{[^}]+\}\}/, '')
    .replace(/\{\{[^}]+\}\}/g, '{id}');
  const segs = path.split('/').filter(Boolean);
  return (segs[0] || 'unknown').replace(/-/g, '_');
}

function normalizePath(url) {
  return (typeof url === 'string' ? url : url?.raw || '')
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/^\{\{[^}]+\}\}/, '')
    .replace(/\{\{[^}]+\}\}/g, '{id}')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/{id}')
    .replace(/^\/([^/]+)/, (_, seg) => '/' + seg.replace(/-/g, '_'));
}

function getNote(item) {
  return item.request?.description || item.description || null;
}

function requestPath(item) {
  const req = item.request;
  if (!req) return null;
  const method = (req.method || 'GET').toUpperCase();
  const path = normalizePath(req.url);
  return `${method} ${path}`;
}

function noteWithPath(item) {
  const desc = getNote(item);
  const path = requestPath(item);
  if (!path) return desc;
  return desc ? `${path}\n${desc}` : path;
}

function isEmissionAssertion(item) {
  const req = item.request;
  if (!req || (req.method || '').toUpperCase() !== 'GET') return false;
  return extractDomain(req.url) === 'platform' && queryParams(req).some(q => q.key === 'type');
}

function getEmittedType(item) {
  return queryParams(item.request).find(q => q.key === 'type')?.value || null;
}

function isReactionAssertion(item) {
  const req = item.request;
  if (!req || (req.method || '').toUpperCase() !== 'GET') return false;
  return extractDomain(req.url) !== 'platform' && queryParams(req).some(q => q.key === 'traceid');
}

function parseEventType(item) {
  const req = item.request;
  if (!req || (req.method || '').toUpperCase() !== 'POST') return null;
  if (extractDomain(req.url) !== 'platform') return null;
  try { return JSON.parse(req.body?.raw || '{}').type || null; }
  catch { return null; }
}

// Extract a readable summary of meaningful scalar fields from an object.
// Skips UUIDs, template variables, ISO timestamps, and fields whose name ends in "Id".
function summarizeFields(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const entries = [];
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') continue;
    if (typeof v === 'string') {
      if (/^\{\{/.test(v)) continue;
      if (/^[0-9a-f]{8}-/i.test(v)) continue;
      if (/^\d{4}-\d{2}-\d{2}T/.test(v)) continue;
    }
    if (/Id$/.test(k) && k !== 'id') continue;
    entries.push(`${k}: ${v}`);
  }
  return entries.length ? entries.join(', ') : null;
}

function extractPayloadSummary(body) {
  return summarizeFields(body?.data);
}

// Build the note for an event injection step:
//   line 1 — POST /platform/events — <eventType>
//   line 2 — relevant data fields (if any)
function injectionNote(item, eventType) {
  let body = null;
  try { body = JSON.parse(item.request?.body?.raw || '{}'); } catch {}
  const summary = extractPayloadSummary(body);
  const line1 = `POST /platform/events — ${eventType}`;
  return summary ? `${line1}\n(${summary})` : line1;
}

// Build the note for an actor-initiated step:
//   line 1 — METHOD /path
//   line 2 — relevant request body fields (if any)
function actorNote(item) {
  const path = requestPath(item);
  const method = (item.request?.method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH'].includes(method)) return path;
  let body = null;
  try { body = JSON.parse(item.request?.body?.raw || '{}'); } catch {}
  const summary = summarizeFields(body);
  return summary ? `${path}\n(${summary})` : path;
}

function inferFrom(item, urlActorMap, branchDomain, scenarioDomain) {
  const req = item.request;
  const method = (req.method || 'GET').toUpperCase();
  const actors = urlActorMap.get(`${method}:${normalizePath(req.url)}`) || [];
  if (actors.length > 0) return actors[0];
  const h = (req.header || []).find(h => h.key === 'X-Caller-Roles');
  if (h?.value) return h.value.split(',')[0].trim();
  return branchDomain || scenarioDomain;
}

function inferDomain(folderName) {
  return folderName.toLowerCase().replace(/\s+branch$/i, '').replace(/\s+/g, '_').trim();
}

function convertItems(items, scenarioDomain, branchDomain, urlActorMap, definedEndpoints, domainsWithPaths, eventSubscriptionMap, hidden = false) {
  const steps = [];
  let pendingEmission = null;
  const actorIds = new Set([...urlActorMap.values()].flat());

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (isHidden(item)) { pendingEmission = null; continue; }

    if (item.item) {
      const selfMark   = getPrereqMarker(item, 'self');
      const optCond    = getPrereqMarker(item, 'opt');
      const hasSection = getPrereqMarker(item, 'section') !== null;
      const childHidden = isHidden(item) ? true : hidden;
      const nonSkipped = item.item.filter(c => !isHidden(c));
      const allFolders = nonSkipped.length > 0 && nonSkipped.every(c => c.item);

      if (selfMark !== null) {
        const selfDomain = selfMark || branchDomain || scenarioDomain;
        steps.push({ self: selfDomain, label: item.name, note: item.description || null });
      } else if (optCond !== null) {
        const children = convertItems(item.item, scenarioDomain, branchDomain, urlActorMap, definedEndpoints, domainsWithPaths, eventSubscriptionMap, childHidden);
        if (children.length > 0)
          steps.push({ fragment: slugify(item.name), type: 'opt', label: optCond, steps: children });
      } else if (allFolders && !hasSection) {
        const emission = pendingEmission;
        pendingEmission = null;
        const operands = nonSkipped.map(sf => {
          const opDomain = inferDomain(sf.name);
          const opSteps = [];
          if (emission) opSteps.push({ event: emission, from: scenarioDomain, to: opDomain });
          opSteps.push(...convertItems(sf.item, scenarioDomain, opDomain, urlActorMap, definedEndpoints, domainsWithPaths, eventSubscriptionMap, childHidden));
          return { label: sf.name.replace(/\b\w/g, c => c.toUpperCase()), steps: opSteps };
        });
        steps.push({ fragment: slugify(item.name), type: 'par', operands });
      } else {
        // Transparent folder — inline its children
        pendingEmission = null;
        if (hasSection) steps.push({ separator: true, label: item.name });
        steps.push(...convertItems(item.item, scenarioDomain, branchDomain, urlActorMap, definedEndpoints, domainsWithPaths, eventSubscriptionMap, childHidden));
      }
      continue;
    }

    const req = item.request;
    if (!req) continue;

    // Self-loop marker on a request item — always renders
    const selfMark = getPrereqMarker(item, 'self');
    if (selfMark !== null) {
      const selfDomain = selfMark || branchDomain || scenarioDomain;
      steps.push({ self: selfDomain, label: item.name, note: noteWithPath(item) });
      continue;
    }

    // Structural requests (emission/reaction assertions, event injections, self-loops) always render.
    // Plain API calls respect the hide/show flag.
    const isStructural = isEmissionAssertion(item) || isReactionAssertion(item)
      || parseEventType(item) !== null || getPrereqMarker(item, 'self') !== null;
    if (hidden && !isShown(item) && !isStructural) continue;

    // Reaction assertion: GET /non-platform-domain?traceid=X — domain reacted to an event.
    // Show as a self-loop on that domain so the reaction is visible in the diagram.
    if (isReactionAssertion(item)) {
      steps.push({ self: extractDomain(req.url), label: item.name, note: noteWithPath(item) });
      continue;
    }

    if (isEmissionAssertion(item)) {
      // Look ahead: if the next non-skipped item is a par-candidate folder, set
      // pendingEmission for event delivery arrows. Otherwise fall through to render
      // as a regular GET call to platform.
      let nextIsParCandidate = false;
      for (let j = i + 1; j < items.length; j++) {
        if (isHidden(items[j])) continue;
        if (items[j].item) {
          const nonSkipped = items[j].item.filter(c => !isHidden(c));
          nextIsParCandidate = nonSkipped.length > 0 && nonSkipped.every(c => c.item);
        }
        break;
      }
      if (nextIsParCandidate) {
        pendingEmission = getEmittedType(item);
        continue;
      }
      // fall through to regular API call rendering
    }

    const eventType = parseEventType(item);
    if (eventType) {
      const fromDomain = eventType.split('.')[0];
      const toDomain = !branchDomain ? scenarioDomain
        : fromDomain === branchDomain ? scenarioDomain : branchDomain;
      steps.push({ label: `Event ${eventType} published`, from: fromDomain, to: toDomain, note: injectionNote(item, eventType) });
      continue;
    }

    const method = (req.method || '').toUpperCase();
    const normalized = normalizePath(req.url);
    const normalizedPath = normalized.split('?')[0];
    const toDomain = extractDomain(req.url);
    const isUndefined = definedEndpoints && !definedEndpoints.has(`${method}:${normalizedPath}`);
    const domainHasPaths = domainsWithPaths && domainsWithPaths.has(toDomain);
    const hasAssertions = (item.event || []).some(e =>
      e.listen === 'test' && (e.script?.exec || []).some(l => l.includes('pm.test('))
    );
    const isExplicitGap = getPrereqMarker(item, 'gap') !== null;
    // Gap: domain has no API paths yet — intentional, API not yet designed.
    // Explicit gap: endpoint is in a domain with paths but intentionally not yet designed —
    // use // x-diagram: gap to suppress broken detection.
    // Broken: domain has paths but this specific path doesn't match, with no assertions to catch it —
    // silent failure. Catches gaps that become implemented with a different shape than anticipated.
    const isGap    = isExplicitGap || (isUndefined && !domainHasPaths);
    const isBroken = !isExplicitGap && isUndefined && domainHasPaths && !hasAssertions;
    // For GET /platform/events?type=<domain>.<event>:
    //   - `from` = emitting domain (event type prefix)
    //   - `to`   = subscribing domain(s) from the event subscription map
    //   - label  = "{Subscriber} subscribes to {eventType}", note = the GET request path
    if (method === 'GET' && toDomain === 'platform') {
      const typeParam = queryParams(req).find(q => q.key === 'type');
      if (typeParam?.value) {
        const emitter = typeParam.value.split('.')[0].replace(/-/g, '_');
        // Causal chain assertion: traceid param means this verifies the emitter reacted to a trace.
        // Render as self-loop on the emitter — do not route to subscribers.
        if (queryParams(req).some(q => q.key === 'traceid')) {
          steps.push({
            self: emitter,
            label: item.name,
            note: noteWithPath(item),
            ...(isGap    && { gap: true,    gap_description:    `${method} ${normalized} — endpoint not yet defined` }),
            ...(isBroken && { broken: true, broken_description: `${method} ${normalized} — domain has paths but this endpoint shape doesn't match any of them` }),
          });
          continue;
        }
        const toConstraint = getPrereqMarker(item, 'to');
        const allSubscribers = eventSubscriptionMap.get(typeParam.value) || [];
        const subscribers = toConstraint
          ? allSubscribers.filter(s => s === toConstraint)
          : allSubscribers;
        if (subscribers.length === 0) {
          steps.push({ self: emitter, label: item.name, note: noteWithPath(item) });
          continue;
        }
        for (const target of subscribers) {
          if (target === emitter) {
            // Domain subscribes to its own event — render as self-loop
            steps.push({
              self: target,
              label: `Event ${typeParam.value} published`,
              note: noteWithPath(item),
              ...(isGap    && { gap: true,    gap_description:    `${method} ${normalized} — endpoint not yet defined` }),
              ...(isBroken && { broken: true, broken_description: `${method} ${normalized} — domain has paths but this endpoint shape doesn't match any of them` }),
            });
          } else {
            steps.push({
              label: `Event ${typeParam.value} published`,
              from: emitter,
              to: target,
              note: noteWithPath(item),
              ...(isGap    && { gap: true,    gap_description:    `${method} ${normalized} — endpoint not yet defined` }),
              ...(isBroken && { broken: true, broken_description: `${method} ${normalized} — domain has paths but this endpoint shape doesn't match any of them` }),
            });
          }
        }
        continue;
      }
    }

    const from = inferFrom(item, urlActorMap, branchDomain, scenarioDomain);
    const isActor = actorIds.has(from);
    const label = isActor ? (getNote(item) || item.name) : item.name;
    const note  = isActor ? actorNote(item) : noteWithPath(item);
    if (from === toDomain) {
      // Same domain on both ends — render as a self-loop rather than a zero-length arrow
      steps.push({
        self: toDomain,
        label,
        note,
        ...(isGap    && { gap: true,    gap_description:    `${method} ${normalized} — endpoint not yet defined` }),
        ...(isBroken && { broken: true, broken_description: `${method} ${normalized} — domain has paths but this endpoint shape doesn't match any of them` }),
      });
    } else {
      steps.push({
        label,
        from,
        to: toDomain,
        note,
        ...(isGap    && { gap: true,    gap_description:    `${method} ${normalized} — endpoint not yet defined` }),
        ...(isBroken && { broken: true, broken_description: `${method} ${normalized} — domain has paths but this endpoint shape doesn't match any of them` }),
      });
    }
  }

  return steps;
}

function collectParticipants(steps) {
  const ids = [];
  const seen = new Set();
  function add(id) { if (id && !seen.has(id)) { seen.add(id); ids.push(id); } }
  function walk(list) {
    for (const s of list) {
      if (s.fragment !== undefined) {
        if (s.operands) s.operands.forEach(op => walk(op.steps || []));
        else walk(s.steps || []);
      } else {
        add(s.from); add(s.to); add(s.self);
      }
    }
  }
  walk(steps);
  return ids;
}

export function postmanToFlow(collection) {
  const urlActorMap = buildUrlActorMap();
  const { defined: definedEndpoints, domainsWithPaths } = buildDefinedEndpoints();
  const eventSubscriptionMap = buildEventSubscriptionMap();
  const domain = getVar(collection.variable, 'domain');

  const steps = [];
  for (const item of (collection.item || [])) {
    if (isHidden(item)) continue;
    if (item.item) {
      const hasOpt  = getPrereqMarker(item, 'opt')  !== null;
      const hasSelf = getPrereqMarker(item, 'self') !== null;
      if (hasOpt || hasSelf) {
        steps.push(...convertItems([item], domain, null, urlActorMap, definedEndpoints, domainsWithPaths, eventSubscriptionMap));
      } else {
        // Top-level folders are always sections — emit a separator then inline children.
        steps.push({ separator: true, label: item.name });
        const childHidden = isHidden(item) ? true : false;
        steps.push(...convertItems(item.item, domain, null, urlActorMap, definedEndpoints, domainsWithPaths, eventSubscriptionMap, childHidden));
      }
    } else {
      steps.push(...convertItems([item], domain, null, urlActorMap, definedEndpoints, domainsWithPaths, eventSubscriptionMap));
    }
  }

  // Actor IDs come from the state machine guard definitions (via urlActorMap values)
  const actorIds = new Set();
  for (const actors of urlActorMap.values()) for (const a of actors) actorIds.add(a);

  const rawIds = collectParticipants(steps);
  const participants = [
    ...rawIds.filter(p => actorIds.has(p)),
    ...rawIds.filter(p => !actorIds.has(p)),
  ];

  return {
    id:          getVar(collection.variable, 'id'),
    domain,
    label:       collection.info.name,
    description: collection.info.description || null,
    participants,
    actorIds:    [...actorIds],
    steps,
  };
}

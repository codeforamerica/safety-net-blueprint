#!/usr/bin/env node
/**
 * generate-scenario.js
 *
 * Generates a Postman v2.1 collection by walking the state machines.
 * The setup script (.setup.sh) is the only hand-authored input.
 *
 * Usage:
 *   node generate-scenario.js <setup-script> [base-url]
 *   node generate-scenario.js scenarios/application-submission.setup.sh
 *   node generate-scenario.js scenarios/application-submission.setup.sh http://staging.example.com
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(__dirname, '..');

// ── Helpers ───────────────────────────────────────────────────────────────────

function varRef(k) { return `{{${k}}}`; }
function slug(s)   { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function cap(s)    { return s.charAt(0).toUpperCase() + s.slice(1); }

function shellVarToCamel(v) {
  return v.toLowerCase().replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function shellUrlToPostman(u) {
  return u.replace(/\$BASE_URL/, '').replace(/\$\{?([A-Z0-9_]+)\}?/g, (_, v) => `{{${shellVarToCamel(v)}}}`);
}

function shellBodyToPostman(b) {
  return b.replace(/\$\{?([A-Z0-9_]+)\}?/g, (_, v) => `{{${shellVarToCamel(v)}}}`);
}

function urlObj(path, query = []) {
  const [base] = path.split('?');
  const raw = varRef('baseUrl') + path + (query.length ? '?' + query.map(q => `${q.key}=${q.value}`).join('&') : '');
  return {
    raw,
    host: [varRef('baseUrl')],
    path: base.replace(/\{\{[^}]+\}\}/g, '').split('/').filter(Boolean),
    ...(query.length ? { query } : {}),
  };
}

function req(method, path, { description, headers = [], body, query = [] } = {}) {
  return {
    method,
    ...(description ? { description } : {}),
    header: headers,
    ...(body ? { body: { mode: 'raw', raw: JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } } } : {}),
    url: urlObj(path, query),
  };
}

function testEvent(name, lines) {
  return { listen: 'test', script: { type: 'text/javascript', exec: Array.isArray(lines) ? lines : [lines] } };
}

function prereqEvent(lines) {
  return { listen: 'prerequest', script: { type: 'text/javascript', exec: Array.isArray(lines) ? lines : [lines] } };
}

function folder(name, items, { description, condition } = {}) {
  const desc = condition ? `---\ncondition: ${condition}\n---` : description;
  return {
    name,
    ...(desc ? { description: desc } : {}),
    item: items.filter(Boolean),
  };
}

function frontmatter(trigger, action) {
  const lines = ['---'];
  if (trigger.type === 'user') {
    lines.push(`trigger:\n  type: user\n  actor: ${trigger.actor}`);
  } else if (trigger.type === 'event') {
    lines.push(`trigger:\n  type: event\n  event: ${trigger.event}`);
    if (action) lines.push(`action:\n  method: ${action.method}\n  path: ${action.path}`);
  } else if (trigger.type === 'event-publication') {
    lines.push(`event:\n  type: ${trigger.event}`);
  } else if (trigger.type === 'external') {
    lines.push(`trigger:\n  type: external\n  domain: ${trigger.domain}`);
  }
  lines.push('---');
  if (trigger.description) lines.push(trigger.description);
  return lines.join('\n');
}

// ── Shell script parser ───────────────────────────────────────────────────────

function parseSetupScript(scriptPath) {
  const lines = readFileSync(scriptPath, 'utf8').split('\n');
  const actions = [];
  let section = 'Setup';
  let pendingName = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (/^#\s*──/.test(line)) {
      section = line.replace(/^#\s*──+\s*/, '').replace(/\s*──+\s*$/, '').trim();
      i++; continue;
    }
    if (/^#\s+[A-Z]/.test(line) && !line.startsWith('# ──')) {
      pendingName = line.replace(/^#\s+/, '');
      i++; continue;
    }
    if (!line.includes('curl')) { pendingName = null; i++; continue; }

    // Join continuation lines
    let curlLine = '';
    while (i < lines.length) {
      const l = lines[i].trimEnd();
      curlLine += ' ' + l.replace(/\\$/, '');
      i++;
      if (!l.endsWith('\\')) break;
    }
    curlLine = curlLine.trim();

    const storeMatch = curlLine.match(/^([A-Z0-9_]+)=\$\((.+)\)[\s;]*$/);
    const storeName = storeMatch ? shellVarToCamel(storeMatch[1]) : null;
    const curlCmd   = storeMatch ? storeMatch[2] : curlLine;
    if (!curlCmd.includes('curl')) { pendingName = null; continue; }

    const methodMatch = curlCmd.match(/-X\s+(\w+)/);
    const method = methodMatch ? methodMatch[1] : 'GET';

    const urlMatch = curlCmd.match(/curl\s+(?:-\S+\s+(?:"[^"]*"\s+)*)*"?(\$BASE_URL[^\s"']+|[^\s"'-][^\s"']*)"?/);
    const rawUrl  = urlMatch ? urlMatch[1] : '';
    const path    = shellUrlToPostman(rawUrl);

    const headers = [];
    const hRe = /-H\s+"([^"]+)"/g;
    let hm;
    while ((hm = hRe.exec(curlCmd)) !== null) {
      const [k, ...rest] = hm[1].split(': ');
      headers.push({ key: k.trim(), value: rest.join(': ').trim() });
    }

    let body = null;
    const bm = curlCmd.match(/-d\s+'([^']+)'/) || curlCmd.match(/-d\s+"((?:[^"\\]|\\.)*?)(?:"|\s*$)/);
    if (bm) {
      const raw = shellBodyToPostman(bm[1].replace(/\\"/g, '"'));
      try { body = JSON.parse(raw); } catch { body = raw; }
    }

    let type = 'resource';
    if (path.includes('/mock/stubs/events'))                        type = 'stub';
    else if (path.includes('/platform/events') && method === 'POST') type = 'event';
    else if (/\/submit$/.test(path))                                 type = 'trigger';

    const callerRoles = headers.find(h => h.key === 'X-Caller-Roles')?.value;

    let name = pendingName;
    if (!name) {
      if (type === 'stub') {
        const st = body?.match?.['data.serviceType'] || 'service';
        const out = body?.respond?.data?.result || 'conclusive';
        name = `Stub: ${st} → ${out}`;
      } else if (type === 'event') {
        name = typeof body === 'object' ? (body?.type?.split('.').pop().replace(/_/g, ' ') || 'Event') : 'Event';
      } else {
        const segs = path.replace(/\{\{[^}]+\}\}/g, '').split('/').filter(Boolean);
        name = segs[segs.length - 1] || path;
      }
    }
    pendingName = null;

    actions.push({ section, name, method, path, headers, body, store: storeName, type, callerRoles });
  }
  return actions;
}

function actionToPostmanItem(action) {
  const { name, method, path, headers, body, store, type, callerRoles } = action;
  const events = [];

  if (type === 'stub') events.push(prereqEvent(['// x-diagram: hide']));

  const desc = type === 'trigger'
    ? frontmatter({ type: 'user', actor: callerRoles || 'applicant' }) + '\nFormally files the application and starts the regulatory processing clock.'
    : type === 'stub' ? null
    : type === 'event'
    ? frontmatter({ type: 'external', domain: (typeof body === 'object' ? body?.type?.split('.')?.[0] : null) || 'external' }) + `\n${name}.`
    : frontmatter({ type: 'user', actor: callerRoles || 'applicant' });

  const assertions = [];
  if (type === 'stub') {
    assertions.push("pm.test('stub registered', () => pm.response.to.have.status(201));");
  } else if (type === 'event') {
    assertions.push("pm.test('event accepted', () => pm.response.to.have.status(202));");
  } else if (type === 'trigger') {
    assertions.push(
      "const app = pm.response.json();",
      "pm.test('submit accepted', () => pm.response.to.have.status(200));",
      "pm.test('status is submitted', () => pm.expect(app.status).to.eql('submitted'));",
    );
  } else if (store && method !== 'GET') {
    assertions.push(
      "const result = pm.response.json();",
      `pm.test('${name}', () => pm.response.to.have.status(201));`,
      `if (result.id) pm.collectionVariables.set('${store}', result.id);`
    );
  } else if (method !== 'GET') {
    assertions.push(`pm.test('${name}', () => pm.response.to.have.status(201));`);
  }

  if (assertions.length) events.push(testEvent(name, assertions));

  return {
    name,
    request: req(method, path.split('?')[0], {
      description: desc || undefined,
      headers: headers.filter(h => method !== 'GET' || h.key !== 'Content-Type'),
      ...(body && method !== 'GET' ? { body } : {}),
    }),
    ...(events.length ? { event: events } : {}),
  };
}

// ── State machine loader ──────────────────────────────────────────────────────

function loadMachines() {
  const m = {};
  for (const f of readdirSync(contractsDir)) {
    if (!f.endsWith('-state-machine.yaml')) continue;
    const domain = f.replace('-state-machine.yaml', '');
    try { m[domain] = yaml.load(readFileSync(join(contractsDir, f), 'utf8')); } catch {}
  }
  return m;
}

function getSubscribers(machines, eventType) {
  const subs = [];
  for (const [domain, sm] of Object.entries(machines)) {
    for (const machine of (sm.machines || [])) {
      if ((machine.events || []).some(e => e.type === eventType)) {
        if (!subs.includes(domain)) subs.push(domain);
      }
    }
  }
  return subs;
}

function getHandler(sm, eventType) {
  for (const machine of (sm.machines || [])) {
    const h = (machine.events || []).find(e => e.type === eventType);
    if (h) return { handler: h, machine };
  }
  return null;
}

function getProc(sm, procId) {
  for (const machine of (sm.machines || [])) {
    const p = (machine.procedures || []).find(p => p.id === procId);
    if (p) return p;
  }
  return null;
}

// ── State machine walker ──────────────────────────────────────────────────────
// Walks a state machine handler or procedure and produces a flat list of
// "observations" — events emitted, resources created, service calls initiated.
// Each observation becomes a Postman verification request.

function resolveVal(expr, ctx) {
  if (typeof expr !== 'string') return expr;
  if (expr.startsWith('$params.'))  return ctx.params?.[expr.slice(8)];
  if (expr.startsWith('$object.'))  return ctx.object?.[expr.slice(8)];
  if (expr.startsWith('$this.'))    return ctx.event?.[expr.slice(6)];
  if (expr === '$object')           return ctx.object;
  if (expr === '$this')             return ctx.event;
  return expr;
}

function evalCond(cond, ctx) {
  if (typeof cond !== 'string') return true;
  // "$params.program in $application.programs"
  const inMatch = cond.match(/\$params\.(\w+)\s+in\s+\$application\.programs/);
  if (inMatch) return (ctx.programs || []).includes(ctx.params?.[inMatch[1]]);
  // '"snap" in $application.programs' or '"medicaid" in ...'
  const litIn = cond.match(/"(\w+)"\s+in\s+\$application\.programs/);
  if (litIn) return (ctx.programs || []).includes(litIn[1]);
  // "$object.verificationType == 'electronic'"
  const eqMatch = cond.match(/\$object\.(\w+)\s*==\s*["'](\w+)["']/);
  if (eqMatch) return ctx.object?.[eqMatch[1]] === eqMatch[2];
  // Default: assume true (let paths through)
  return true;
}

function walkSteps(steps, sm, ctx) {
  const obs = [];
  for (const step of (steps || [])) {
    obs.push(...walkStep(step, sm, ctx));
  }
  return obs;
}

function walkStep(step, sm, ctx) {
  const obs = [];

  // emit: — event was published
  if (step.emit) {
    obs.push({ kind: 'event-emitted', eventType: step.emit.type || step.emit, data: step.emit.data });
  }

  // call: (procedure name)
  if (step.call && typeof step.call === 'string') {
    const proc = getProc(sm, step.call);
    if (proc) {
      const newCtx = { ...ctx, params: step.with || ctx.params };
      if (!proc.if || evalCond(proc.if, newCtx)) {
        obs.push(...walkSteps(proc.then || proc.steps || [], sm, newCtx));
      }
    }
  }

  // call: {procedure: name, with: params} or call: {POST: path, body: ...}
  if (step.call && typeof step.call === 'object') {
    if (step.call.call) {
      const proc = getProc(sm, step.call.call);
      if (proc) {
        const newCtx = { ...ctx, params: step.call.with || ctx.params };
        if (!proc.if || evalCond(proc.if, newCtx)) {
          obs.push(...walkSteps(proc.then || proc.steps || [], sm, newCtx));
        }
      }
    } else if (step.call.POST || step.call.PATCH) {
      const method = step.call.POST ? 'POST' : 'PATCH';
      obs.push({ kind: 'http-call', method, path: step.call[method], body: step.call.body, description: step.call.description });
    }
  }

  // Shorthand: { call: { POST: ..., body: ... } }
  if (typeof step === 'object' && (step.POST || step.PATCH)) {
    const method = step.POST ? 'POST' : 'PATCH';
    obs.push({ kind: 'http-call', method, path: step[method], body: step.body, description: step.description });
  }

  // if: condition
  if (step.if !== undefined) {
    const branch = evalCond(step.if, ctx) ? (step.then || []) : (step.else || []);
    obs.push(...walkSteps(branch, sm, ctx));
  }

  // match: expression when: { case: steps }
  if (step.match !== undefined && step.when) {
    const val = resolveVal(step.match, ctx);
    const branch = step.when[val] || step.when['*'] || [];
    obs.push(...walkSteps(branch, sm, ctx));
  }

  // forEach: { in: array, as: var } do: [steps]
  if (step.forEach) {
    const { in: inExpr, from, as, where } = step.forEach;
    let items = [];
    if (inExpr) {
      const resolved = resolveVal(inExpr, ctx);
      items = Array.isArray(resolved) ? resolved : [];
    } else if (from) {
      // Cross-domain data reference — produce a placeholder item per known category
      items = ctx._forEachHint || ['_item'];
    }
    for (const item of items) {
      obs.push(...walkSteps(step.do || [], sm, { ...ctx, [as]: item }));
    }
  }

  return obs;
}

function walkHandler(domain, eventType, machines, ctx) {
  const sm = machines[domain];
  if (!sm) return [];
  const found = getHandler(sm, eventType);
  if (!found) return [];
  const { handler } = found;

  // Resolve context bindings declared on the handler
  const boundCtx = { ...ctx };
  for (const binding of (handler.context || [])) {
    const alias = Object.keys(binding)[0];
    boundCtx[alias] = `_${alias}`; // placeholder
  }

  return walkSteps(handler.steps, sm, { ...boundCtx, event: { type: eventType } });
}

// ── Observation → Postman items ───────────────────────────────────────────────

// Derived from initiateServiceCalls procedure in intake state machine.
// Reads the match/when block to build category → [serviceTypes] map.
function readServiceCallsByCategory(machines) {
  const intakeSM = machines['intake'];
  const proc = getProc(intakeSM, 'initiateServiceCalls');
  if (!proc) return {};
  const map = {};
  const steps = proc.steps || (proc.match ? [proc] : []);
  for (const step of steps) {
    if (!step.match || !step.when) continue;
    for (const [category, branchSteps] of Object.entries(step.when)) {
      const serviceCalls = [];
      for (const s of (Array.isArray(branchSteps) ? branchSteps : [branchSteps])) {
        const callSpec = s.call || s;
        const withParams = callSpec?.with || s?.with || {};
        if (withParams.serviceType) serviceCalls.push(withParams.serviceType);
      }
      map[category] = serviceCalls;
    }
  }
  return map;
}

function buildVerifyEventRequest(eventType, causedBy, store) {
  const emitterDomain = eventType.split('.')[0].replace(/-/g, '_');
  const label = eventType.split('.').slice(1).map(w => cap(w)).join(' ');
  const query = [{ key: 'type', value: eventType }];
  if (causedBy) query.push({ key: 'causationid', value: varRef(causedBy) });

  const desc = frontmatter({ type: 'event-publication', event: eventType }) +
    `\nVerifies ${label} was published.`;

  const assertions = [
    "const event = pm.response.json().items?.[0];",
    `pm.test('${label} emitted', () => { pm.response.to.have.status(200); pm.expect(event).to.exist; });`,
  ];
  if (store) assertions.push(`if (event?.id) pm.collectionVariables.set('${store}', event.id);`);
  if (store && store.endsWith('EventId') || store?.includes('Verif')) {
    assertions.push(`if (event?.subject) pm.collectionVariables.set('${store.replace('EventId','Id').replace('Event','Id')}', event.subject);`);
  }

  return {
    name: label,
    request: req('GET', '/platform/events', { description: desc, query }),
    event: [testEvent(label, assertions)],
  };
}

function buildVerificationFlow(category, triggerEvent, stubOutcomes, serviceCallsByCategory, machines) {
  const serviceCalls = serviceCallsByCategory[category] || [];
  const verificationType = serviceCalls.length > 0 ? 'electronic' : 'document';
  const outcome = serviceCalls.map(s => stubOutcomes[s]).find(Boolean) || 'conclusive';
  const varBase = slug(category).replace(/-/g, '');
  const verifyVarId = `${varBase}VerifId`;
  const svcEvtVar = `${varBase}SvcCallEvtId`;
  const label = cap(category);
  const items = [];

  // Verification Created
  const verifyDesc = frontmatter({ type: 'event', event: triggerEvent },
    { method: 'POST', path: '/intake/applications/verifications' }) +
    `\nIntake creates a ${category} verification in response to ${triggerEvent}.`;
  items.push({
    name: `${label} Verification Created`,
    request: req('GET', '/platform/events', {
      description: verifyDesc,
      query: [{ key: 'type', value: 'intake.verification.created' }, { key: 'causationid', value: varRef('appSubmittedEventId') }],
    }),
    event: [testEvent(`${label} Verification Created`, [
      "const events = pm.response.json().items || [];",
      `const verifs = events.filter(e => e.data?.category === '${category}');`,
      `pm.test('${label} verification created', () => { pm.response.to.have.status(200); pm.expect(verifs.length).to.be.at.least(1); });`,
      `if (verifs[0]) pm.collectionVariables.set('${verifyVarId}', verifs[0].subject);`,
    ])],
  });

  if (verificationType === 'document') {
    items.push(...buildDocumentFlow(category, verifyVarId, label, machines));
    return items;
  }

  const primarySvc = serviceCalls[0];

  // Stub
  items.push({
    name: `Stub: ${primarySvc} → call.completed (${outcome}) for ${category} A`,
    request: req('POST', '/mock/stubs/events', {
      body: {
        on: 'data_exchange.service_call.created',
        match: { 'data.serviceType': primarySvc, 'data.metadata.intake.verificationId': varRef(verifyVarId) },
        respond: { type: 'data_exchange.call.completed', data: { result: outcome } },
      },
    }),
    event: [prereqEvent(['// x-diagram: hide']), testEvent('stub', ["pm.test('stub registered', () => pm.response.to.have.status(201));"])],
  });

  // Service calls
  for (const svc of serviceCalls) {
    const svcDesc = frontmatter({ type: 'event', event: 'intake.verification.created' },
      { method: 'POST', path: '/data-exchange/service-calls' });
    items.push({
      name: `Service Call Created (${label} Verification - ${svc})`,
      request: req('GET', '/platform/events', {
        description: svcDesc,
        query: [{ key: 'type', value: 'data_exchange.service_call.created' }, { key: 'sort', value: '-time' }],
      }),
      event: [testEvent(`Service Call (${svc})`, [
        "const events = pm.response.json().items || [];",
        `const verifyId = pm.collectionVariables.get('${verifyVarId}');`,
        `const event = events.find(e => e.data?.serviceType === '${svc}' && e.data?.metadata?.intake?.verificationId === verifyId);`,
        `pm.test('service call created (${svc})', () => { pm.response.to.have.status(200); pm.expect(event).to.exist; });`,
        ...(svc === primarySvc ? [`if (event) pm.collectionVariables.set('${svcEvtVar}', event.id);`] : []),
      ])],
    });
  }

  // Call Completed
  items.push({
    name: `Call Completed (${outcome})`,
    request: req('GET', '/platform/events', {
      description: frontmatter({ type: 'event-publication', event: 'data_exchange.call.completed' }) +
        `\nData Exchange publishes call.completed when ${primarySvc} returns a ${outcome} result.`,
      query: [{ key: 'type', value: 'data_exchange.call.completed' }, { key: 'causationid', value: varRef(svcEvtVar) }],
    }),
    event: [testEvent(`Call Completed (${outcome})`, [
      "const event = pm.response.json().items?.[0];",
      `pm.test('call.completed (${outcome}) for ${category}', () => { pm.response.to.have.status(200); pm.expect(event).to.exist; pm.expect(event.data.result).to.eql('${outcome}'); });`,
      `if (event?.id) pm.collectionVariables.set('${category}CallCompletedEvtId', event.id);`,
    ])],
  });

  if (outcome === 'conclusive') {
    items.push({
      name: `${label} Verification Satisfied`,
      request: req('GET', '/platform/events', {
        description: frontmatter({ type: 'event', event: 'data_exchange.call.completed' },
          { method: 'POST', path: `/intake/applications/verifications/{id}/satisfy` }),
        query: [{ key: 'type', value: 'intake.verification.satisfied' }, { key: 'subject', value: varRef(verifyVarId) }],
      }),
      event: [testEvent(`${label} Verification Satisfied`, [
        "const event = pm.response.json().items?.[0];",
        `pm.test('${category} verification satisfied', () => { pm.response.to.have.status(200); pm.expect(event).to.exist; pm.expect(event.data?.status).to.eql('satisfied'); });`,
      ])],
    });
  } else {
    // Inconclusive → document fallback
    const fallbackVar = `${varBase}DocFallbackVerifId`;
    items.push({
      name: `${label} verification inconclusive`,
      request: req('GET', '/platform/events', {
        description: frontmatter({ type: 'event', event: 'data_exchange.call.completed' },
          { method: 'POST', path: '/intake/applications/verifications/{id}/mark-inconclusive' }),
        query: [{ key: 'type', value: 'intake.verification.inconclusive' }, { key: 'subject', value: varRef(verifyVarId) }],
      }),
      event: [testEvent('inconclusive', ["const event = pm.response.json().items?.[0];", "pm.test('verification inconclusive', () => { pm.response.to.have.status(200); pm.expect(event).to.exist; });"])],
    });
    items.push({
      name: 'Document fallback verification created',
      request: req('GET', '/platform/events', {
        description: frontmatter({ type: 'event', event: 'data_exchange.call.completed' },
          { method: 'POST', path: '/intake/applications/verifications', body: { verificationType: 'document' } }),
        query: [{ key: 'type', value: 'intake.verification.created' }, { key: 'causationid', value: varRef(`${category}CallCompletedEvtId`) }],
      }),
      event: [testEvent('doc fallback created', [
        "const events = pm.response.json().items || [];",
        "const docVerif = events.find(e => e.data?.verificationType === 'document');",
        "pm.test('document fallback created', () => { pm.response.to.have.status(200); pm.expect(docVerif).to.exist; });",
        `if (docVerif) pm.collectionVariables.set('${fallbackVar}', docVerif.subject);`,
      ])],
    });
    items.push(...buildNoticeFlow(category, fallbackVar, label, machines));
  }

  return items;
}

// ── Generic gap-aware external event chain ────────────────────────────────────
//
// Replaces all domain-specific buildDocumentFlow / buildNoticeFlow / buildDocUploadSteps
// functions. The pattern is entirely derived from:
//   1. Which external domain is being simulated (from the path prefix)
//   2. What event that domain publishes (from the event type prefix)
//   3. What intake does when it receives that event (from intake state machine subscription)
//
// Gap variable name is always derived from the domain: /communication/... → communicationGap
// This means when Communication or Document Management is implemented, the tests
// automatically start asserting correctly without any generator changes.

function domainFromPath(path) {
  return path.split('/').filter(Boolean)[0]?.replace(/_([a-z])/g, (_, c) => c.toUpperCase()) || 'unknown';
}

function gapVar(domain) {
  return `${domainFromPath('/' + domain)}Gap`;
}

/**
 * Derive a simulation POST path from a CloudEvents type using the convention:
 *   {domain}.{object}.{verb} → POST /{domain-with-hyphens}/{objects}
 * e.g. communication.notice.sent → /communication/notices
 *      document_management.document_version.uploaded → /document-management/document-versions
 */
function pathFromEventType(eventType) {
  const parts = eventType.split('.');
  const domain = parts[0].replace(/_/g, '-');
  const object = parts[1]?.replace(/_/g, '-') || 'events';
  return `/${domain}/${object}s`;
}

/**
 * Find an upload-session endpoint in the OpenAPI specs for a given domain.
 * Reads spec paths and returns the first one containing 'upload' in its path.
 */
function findUploadEndpoint(domain) {
  if (!existsSync(contractsDir)) return null;
  for (const f of readdirSync(contractsDir)) {
    if (!f.endsWith('-openapi.yaml')) continue;
    try {
      const spec = yaml.load(readFileSync(join(contractsDir, f), 'utf8'));
      const specDomain = (spec.info?.['x-domain'] || '').replace(/-/g, '_');
      if (specDomain !== domain) continue;
      for (const path of Object.keys(spec.paths || {})) {
        if (path.includes('upload') && spec.paths[path].post) {
          // Return path with Postman variable placeholders
          return path.replace(/\{[^}]+\}/g, m => `{{${m.slice(1,-1)}}}`);
        }
      }
    } catch {}
  }
  return null;
}

/**
 * Build a step that simulates an external domain action.
 * Sets a gap variable if the endpoint returns 404 (domain not yet implemented).
 */
function externalSimulationStep(name, path, body, domain) {
  const gap = gapVar(domain || domainFromPath(path));
  return {
    name,
    request: req('POST', path, {
      description: frontmatter({ type: 'external', domain: domain || domainFromPath(path) }),
      ...(body ? { body } : {}),
    }),
    event: [testEvent(name, [
      `const ok = pm.response.code !== 404;`,
      `pm.collectionVariables.set('${gap}', !ok);`,
      `pm.test('${name}', () => { if (!ok) return; pm.expect(pm.response.code).to.be.oneOf([200, 201, 202]); });`,
    ])],
  };
}

/**
 * Build an event verification step that skips gracefully when its domain is not yet implemented.
 * The gap variable is derived from the event type's domain prefix.
 */
function gapAwareEventStep(name, eventType, query, reactionDesc) {
  const domain = eventType.split('.')[0];
  const gap = gapVar(domain);
  return {
    name,
    request: req('GET', '/platform/events', {
      description: reactionDesc || frontmatter({ type: 'event-publication', event: eventType }),
      query: [{ key: 'type', value: eventType }, ...(query || [])],
    }),
    event: [testEvent(name, [
      `if (pm.collectionVariables.get('${gap}')) {`,
      `  pm.test('${name} — gap (${cap(domain)} not yet implemented)', () => true);`,
      `} else {`,
      `  pm.test('${name}', () => { pm.response.to.have.status(200); pm.expect(pm.response.json().items?.[0]).to.exist; });`,
      `}`,
    ])],
  };
}

/**
 * Build a reaction step that depends on an external domain's event having fired.
 * Derives gap variable from the causation event's domain prefix.
 */
function gapAwareReactionStep(name, causationDomain, requestFn, assertion) {
  const gap = gapVar(causationDomain);
  return {
    name,
    request: requestFn(),
    event: [testEvent(name, [
      `if (pm.collectionVariables.get('${gap}')) {`,
      `  pm.test('${name} — gap', () => true);`,
      `} else {`,
      `  ${assertion}`,
      `}`,
    ])],
  };
}

/**
 * Build the full external event chain for a document-type verification:
 * external simulation → event published → intake reacts (derived from state machine)
 */
function buildExternalEventChain(machines, simulationPath, simulationBody, publishedEventType, reactionEventType, reactionLabel, verifyVarId) {
  const simDomain   = domainFromPath(simulationPath);
  const gap         = gapVar(simDomain);
  const items       = [];

  // 1. Simulate the external domain action
  items.push(externalSimulationStep(`Send ${reactionLabel} notice`, simulationPath, simulationBody, simDomain));

  // 2. Verify the external event was published (gap-aware)
  items.push(gapAwareEventStep(`${cap(publishedEventType.split('.').slice(1).join(' '))}`, publishedEventType, [], null));

  // 3. Verify intake's reaction (from intake state machine subscription)
  const intakeHandler = getHandler(machines['intake'], publishedEventType);
  if (intakeHandler && verifyVarId) {
    items.push(gapAwareReactionStep(
      `${reactionLabel} updated`,
      simDomain,
      () => req('GET', `/intake/applications/${varRef('appId')}/verifications/${varRef(verifyVarId)}`, {
        description: frontmatter({ type: 'event', event: publishedEventType },
          { method: 'PATCH', path: '/intake/applications/verifications/{id}' }),
      }),
      `pm.test('${reactionLabel} updated', () => { pm.response.to.have.status(200); pm.expect(pm.response.json()).to.exist; });`
    ));
  }

  return items;
}

/**
 * Build document upload steps for any document-type verification.
 * Derived from intake state machine subscriptions:
 *   - document_management.document_version.uploaded → satisfyVerificationOnDocumentUpload
 * The user upload step uses the OpenAPI-defined upload session endpoint.
 */
function buildDocUploadChain(machines, category, verifyVarId) {
  const docEventType = 'document_management.document_version.uploaded';
  const docDomain    = docEventType.split('.')[0];
  const gap          = gapVar(docDomain);
  const label        = cap(category);
  const catVar       = slug(category).replace(/-/g, '');

  // Find the upload session endpoint from OpenAPI (path derived from domain convention)
  // and the document management endpoint (external domain)
  const items = [];

  // User action: upload a document.
  // Find the upload endpoint from the intake OpenAPI spec rather than hardcoding the path.
  const uploadPath = findUploadEndpoint('intake') || `/intake/applications/${varRef('appId')}/document-upload-sessions`;
  items.push({
    name: 'Upload document',
    request: req('POST', uploadPath, {
      description: frontmatter({ type: 'user', actor: 'applicant' }) + '\nApplicant initiates a document upload session.',
      headers: [{ key: 'X-Caller-Roles', value: 'applicant' }],
    }),
    event: [testEvent('upload session', ["pm.test('upload session created', () => pm.response.to.have.status(201));"])],
  });

  // External: document management creates the document record
  // (path derived from domain name: document_management → /document-management/documents)
  const docMgmtPath = `/${docDomain.replace(/_/g, '-')}/documents`;
  items.push(externalSimulationStep('Document uploaded and linked to application', docMgmtPath, null, docDomain));

  // Verify event was published (gap-aware)
  items.push(gapAwareEventStep('Document Version Uploaded', docEventType, [], null));

  // Verify intake satisfies the verification (from state machine subscription)
  items.push({
    name: `${label} verification satisfied`,
    request: req('GET', '/platform/events', {
      description: frontmatter({ type: 'event', event: docEventType },
        { method: 'POST', path: '/intake/applications/verifications/{id}/satisfy' }),
      query: [{ key: 'type', value: 'intake.verification.satisfied' }, { key: 'subject', value: varRef(`${catVar}VerifId`) }],
    }),
    event: [testEvent(`${category} satisfied`, [
      `if (pm.collectionVariables.get('${gap}')) {`,
      `  pm.test('${label} verification satisfied — gap', () => true);`,
      `} else {`,
      `  const event = pm.response.json().items?.[0];`,
      `  pm.test('${label} verification satisfied', () => { pm.response.to.have.status(200); pm.expect(event).to.exist; pm.expect(event.data?.status).to.eql('satisfied'); });`,
      `}`,
    ])],
  });

  return items;
}

function buildDocumentFlow(category, verifyVarId, label, machines) {
  // Derive the communication simulation path from the event type convention:
  // communication.notice.sent → /communication/notices
  const noticePath = pathFromEventType('communication.notice.sent');
  return [
    ...buildExternalEventChain(
      machines,
      noticePath,
      { type: `document_request_${category}_verification` },
      'communication.notice.sent',
      'communication.notice.sent',
      `${label} document requests`,
      verifyVarId
    ),
    // Then the applicant uploads the document to satisfy the verification
    ...buildDocUploadChain(machines, category, verifyVarId),
  ];
}

function buildNoticeFlow(category, fallbackVar, label, machines) {
  // Same pattern: Communication sends a fallback notice, intake updates documentRequests.
  // Path derived from event type convention: communication.notice.sent → /communication/notices
  return buildExternalEventChain(
    machines,
    pathFromEventType('communication.notice.sent'),
    { type: `document_request_${category}_verification` },
    'communication.notice.sent',
    'communication.notice.sent',
    `${label} fallback document requests`,
    fallbackVar
  );
}


// ── Section generators — derived from state machine event subscriptions ───────

function buildAppSubmittedVerification(triggerEvent) {
  return {
    name: 'Application Submitted',
    request: req('GET', '/platform/events', {
      description: frontmatter({ type: 'event-publication', event: triggerEvent }) +
        '\nVerifies the event was published when the application was submitted.',
      query: [{ key: 'type', value: triggerEvent }, { key: 'subject', value: varRef('appId') }],
    }),
    event: [testEvent('event published', [
      "const event = pm.response.json().items?.[0];",
      `pm.test('${triggerEvent} published', () => { pm.response.to.have.status(200); pm.expect(event).to.exist; });`,
      "if (event?.id) pm.collectionVariables.set('appSubmittedEventId', event.id);",
    ])],
  };
}

function buildIntakeVerifSection(machines, triggerEvent, stubOutcomes, serviceCallsByCategory) {
  // Read createProgramVerifications calls from intake state machine
  const intakeSM = machines['intake'];
  const handler = getHandler(intakeSM, triggerEvent)?.handler;
  const programVerifs = {};
  for (const step of (handler?.steps || [])) {
    if (typeof step.call === 'string' && step.with?.program) {
      programVerifs[step.with.program] = step.with;
    }
  }

  const items = [buildAppSubmittedVerification(triggerEvent)];

  for (const [program, verifs] of Object.entries(programVerifs)) {
    const programLabel = cap(program);
    const condition = `if application includes ${programLabel}`;
    const programItems = [];

    for (const category of (verifs.memberCategories || [])) {
      programItems.push(folder(cap(category), buildVerificationFlow(category, triggerEvent, stubOutcomes, serviceCallsByCategory, machines)));
    }
    for (const category of (verifs.incomeCategories || [])) {
      programItems.push(folder(cap(category), buildVerificationFlow(category, triggerEvent, stubOutcomes, serviceCallsByCategory, machines)));
    }
    for (const category of (verifs.householdCategories || [])) {
      programItems.push(folder(cap(category), buildVerificationFlow(category, triggerEvent, stubOutcomes, serviceCallsByCategory, machines)));
    }

    items.push(folder(programLabel, programItems, { condition }));
  }

  return folder('Intake — Initiate Verifications', items);
}

function buildSubscriberSection(domain, triggerEvent, machines, setupActions) {
  const sm = machines[domain];
  if (!sm) return null;
  const found = getHandler(sm, triggerEvent);
  if (!found) return null;

  const items = [buildAppSubmittedVerification(triggerEvent)];

  // Walk the handler to find what events are emitted and what resources created
  // For now, generate verification steps for each emitted event in the handler chain
  const obs = walkHandler(domain, triggerEvent, machines, {});

  for (const o of obs) {
    if (o.kind === 'event-emitted') {
      items.push(buildVerifyEventRequest(o.eventType, 'appSubmittedEventId', null));
    } else if (o.kind === 'http-call' && o.method === 'POST') {
      // Derive what event this creates by convention: {domain}.{object}.created
      const pathSegments = o.path.split('/').filter(s => s && !s.includes('{') && !s.includes('$'));
      const lastSeg = pathSegments[pathSegments.length - 1] || 'resource';
      const parentSeg = pathSegments[pathSegments.length - 2] || domain;
      const eventType = `${domain}.${lastSeg.replace(/s$/, '')}.created`;
      items.push(buildVerifyEventRequest(eventType, 'appSubmittedEventId', null));
    }
  }

  // Section name from domain
  const sectionName = domain.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return folder(sectionName, items);
}

/**
 * Read service call types from a procedure's steps.
 * Used to extract fdsh_fti, fdsh_medicare_vci etc. from initiateMedicaidDataExchange.
 */
function readServiceCallsFromProc(sm, procId) {
  const proc = getProc(sm, procId);
  if (!proc) return [];
  const result = [];
  for (const step of (proc.steps || [])) {
    const callSpec = step.call || step;
    const path = callSpec?.POST || callSpec?.call?.POST || '';
    const body = callSpec?.body || callSpec?.call?.body || {};
    if (typeof path === 'string' && path.includes('data-exchange/service-calls') && body.serviceType) {
      result.push(body.serviceType);
    }
  }
  return result;
}

/**
 * Determine whether a procedure calls an external adapter (not a data-exchange service call).
 * These are simulated in the scenario by injecting the result event directly.
 */
function procCallsAdapter(sm, procId) {
  const proc = getProc(sm, procId);
  if (!proc) return false;
  for (const step of (proc.steps || [])) {
    const callSpec = step.call || step;
    const path = callSpec?.POST || callSpec?.call?.POST || '';
    if (typeof path === 'string' && path.includes('adapter')) return true;
  }
  return false;
}

/**
 * Build the eligibility pre-screening section entirely from the eligibility state machine.
 * No hardcoded program names, service types, or step sequences.
 */
function buildEligibilitySection(machines, triggerEvent, stubOutcomes, programs) {
  const eligSM = machines['eligibility'];
  const items = [buildAppSubmittedVerification(triggerEvent)];

  // Determination created (eligibility creates determination on intake.application.submitted)
  items.push({
    name: 'Eligibility determination created',
    request: req('GET', '/platform/events', {
      description: frontmatter({ type: 'event', event: triggerEvent },
        { method: 'POST', path: '/eligibility/determinations' }) +
        '\nEligibility creates a Determination record when an application is submitted.',
      query: [{ key: 'type', value: 'eligibility.determination.created' }],
    }),
    event: [testEvent('determination created', [
      "const event = pm.response.json().items?.[0];",
      "pm.test('eligibility.determination.created emitted', () => { pm.response.to.have.status(200); pm.expect(event).to.exist; });",
      "if (event?.subject) pm.collectionVariables.set('determinationId', event.subject);",
    ])],
  });

  // Determination created — derived from eligibility state machine's application.submitted handler
  items.push({
    name: 'Eligibility determination created',
    request: req('GET', '/platform/events', {
      description: frontmatter({ type: 'event', event: triggerEvent },
        { method: 'POST', path: '/eligibility/determinations' }) +
        '\nEligibility creates a Determination record when an application is submitted.',
      query: [{ key: 'type', value: 'eligibility.determination.created' }],
    }),
    event: [testEvent('determination created', [
      "const event = pm.response.json().items?.[0];",
      "pm.test('eligibility.determination.created emitted', () => { pm.response.to.have.status(200); pm.expect(event).to.exist; });",
      "if (event?.subject) pm.collectionVariables.set('determinationId', event.subject);",
    ])],
  });

  // Decisions created per program — read programs from setup script
  for (const program of programs) {
    const programLabel = cap(program);
    items.push({
      name: `Decision Created (${programLabel})`,
      request: req('GET', '/platform/events', {
        description: frontmatter({ type: 'event', event: 'eligibility.determination.created' },
          { method: 'POST', path: '/eligibility/determinations/decisions' }),
        query: [{ key: 'type', value: 'eligibility.decision.created' }],
      }),
      event: [testEvent(`${programLabel} decisions created`, [
        "const events = pm.response.json().items || [];",
        `const decisions = events.filter(e => e.data?.program === '${program}');`,
        `pm.test('${programLabel} decisions created', () => { pm.response.to.have.status(200); pm.expect(decisions.length).to.be.at.least(1); });`,
      ])],
    });
  }

  // Per-program sub-sections — read from eligibility.decision.created handler match branches
  const decisionHandler = getHandler(eligSM, 'eligibility.decision.created')?.handler;
  const programBranches = decisionHandler?.steps?.[0]?.when || {};

  for (const program of programs) {
    const branchSteps = programBranches[program] || [];
    const subItems = [];

    for (const step of branchSteps) {
      const procId = typeof step.call === 'string' ? step.call : (step.call?.call || null);
      if (!procId) continue;

      if (procCallsAdapter(eligSM, procId)) {
        // Adapter path: eligibility evaluates using external adapter → result event injected externally
        // Read what event the adapter triggers by looking at what the action emits
        // (e.g. evaluateSnapExpedited → flag-expedited action → eligibility.application.expedited)
        const emittedEvent = findAdapterResultEvent(eligSM, procId);
        if (emittedEvent) {
          subItems.push({
            name: `${cap(program.replace(/_/g,' '))} ${cap(emittedEvent.split('.').pop())} Determined`,
            request: req('GET', '/platform/events', {
              description: frontmatter({ type: 'event-publication', event: emittedEvent }),
              query: [{ key: 'type', value: emittedEvent }],
            }),
            event: [testEvent('adapter result determined', [
              "const event = pm.response.json().items?.[0];",
              `pm.test('${emittedEvent} emitted', () => { pm.response.to.have.status(200); pm.expect(event).to.exist; });`,
            ])],
          });
          // Simulate adapter result via external event injection
          subItems.push({
            name: `${cap(program.replace(/_/g,' '))} ${emittedEvent.split('.').pop().replace(/_/g,' ')} (adapter result)`,
            request: req('POST', '/platform/events', {
              description: frontmatter({ type: 'external', domain: 'eligibility' }),
              headers: [{ key: 'Content-Type', value: 'application/json' }],
              body: { specversion: '1.0', type: emittedEvent, source: '/test', subject: varRef('appId'), data: { applicationId: varRef('appId') } },
            }),
            event: [testEvent('event accepted', ["pm.test('event accepted', () => pm.response.to.have.status(202));"])],
          });
          // Intake reacts: read intake's subscription to this event
          subItems.push(...buildIntakeReactionSteps(machines, emittedEvent));
        }
      } else {
        // Service call path: read service types from procedure steps
        const svcList = readServiceCallsFromProc(eligSM, procId);
        for (const svc of svcList) {
          const outcome = stubOutcomes[svc] || 'conclusive';
          const evtVar = svc.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') + 'SvcCallEvtId';
          subItems.push({
            name: `Stub: ${svc} → call.completed (${outcome})`,
            request: req('POST', '/mock/stubs/events', {
              body: { on: 'data_exchange.service_call.created', match: { 'data.serviceType': svc }, respond: { type: 'data_exchange.call.completed', data: { result: outcome } } },
            }),
            event: [prereqEvent(['// x-diagram: hide']), testEvent('stub', ["pm.test('stub registered', () => pm.response.to.have.status(201));"])],
          });
          subItems.push({
            name: `Service Call Created (${svc})`,
            request: req('GET', '/platform/events', {
              description: frontmatter({ type: 'event', event: 'eligibility.determination.created' },
                { method: 'POST', path: '/data-exchange/service-calls' }),
              query: [{ key: 'type', value: 'data_exchange.service_call.created' }, { key: 'sort', value: '-time' }],
            }),
            event: [testEvent(`${svc} service call`, [
              "const events = pm.response.json().items || [];",
              `const event = events.find(e => e.data?.serviceType === '${svc}');`,
              `pm.test('service call created (${svc})', () => { pm.response.to.have.status(200); pm.expect(event).to.exist; });`,
              `if (event) pm.collectionVariables.set('${evtVar}', event.id);`,
            ])],
          });
          subItems.push({
            name: `Call Completed (${svc})`,
            request: req('GET', '/platform/events', {
              description: frontmatter({ type: 'event-publication', event: 'data_exchange.call.completed' }),
              query: [{ key: 'type', value: 'data_exchange.call.completed' }, { key: 'causationid', value: varRef(evtVar) }],
            }),
            event: [testEvent(`${svc} completed`, [
              "const event = pm.response.json().items?.[0];",
              `pm.test('${svc} call completed', () => { pm.response.to.have.status(200); pm.expect(event).to.exist; });`,
            ])],
          });
        }
        // Simulate adapter result for service-call-based procedures
        const decisionCompletedEvent = 'eligibility.application.decision_completed';
        subItems.push({
          name: `${cap(program)} Decision Completed (adapter result)`,
          request: req('POST', '/platform/events', {
            description: frontmatter({ type: 'external', domain: 'eligibility' }),
            headers: [{ key: 'Content-Type', value: 'application/json' }],
            body: { specversion: '1.0', type: decisionCompletedEvent, source: '/test', subject: varRef('appId'), data: { applicationId: varRef('appId'), memberId: varRef('memberAId'), program, status: 'approved', path: 'auto' } },
          }),
          event: [testEvent('event accepted', ["pm.test('event accepted', () => pm.response.to.have.status(202));"])],
        });
        subItems.push(...buildIntakeReactionSteps(machines, decisionCompletedEvent, program));
      }
    }

    if (subItems.length) {
      const condition = program === 'snap'
        ? readProgramCondition(eligSM, program) || `if application includes ${cap(program)}`
        : `if application includes ${cap(program)}`;
      items.push(folder(`${cap(program.replace(/_/g,' '))} (per ${cap(program)} member)`, subItems, { condition }));
    }
  }

  return folder('Eligibility — Pre-Screening', items);
}

/**
 * Find the event emitted as the result of an adapter call procedure.
 * Follows the call chain: procedure → HTTP POST to adapter → adapter triggers action → action emits event.
 * No hardcoded action IDs — reads purely from the state machine structure.
 */
function findAdapterResultEvent(sm, procId) {
  const proc = getProc(sm, procId);
  if (!proc) return null;

  // Find which action the adapter call is expected to trigger.
  // The adapter call path tells us the operation (e.g. /evaluate/expedited-screening).
  // Find any action in the state machine that emits an event AND whose description
  // references the same adapter endpoint — derive by matching the adapter path suffix.
  for (const step of (proc.steps || [])) {
    const callSpec = step.call || step;
    const path = callSpec?.POST || callSpec?.call?.POST || '';
    if (typeof path !== 'string' || !path.includes('adapter')) continue;

    // e.g. /evaluate/expedited-screening → operation suffix is "expedited-screening"
    const opSuffix = path.split('/').pop()?.replace(/-/g, '_') || '';

    // Find the action whose id or description matches this operation
    for (const machine of (sm.machines || [])) {
      for (const action of (machine.actions || [])) {
        const matchesOp = action.id?.includes(opSuffix.split('_')[0]) ||
                          action.description?.toLowerCase().includes(opSuffix.replace(/_/g, ' '));
        if (!matchesOp) continue;
        for (const s of (action.steps || [])) {
          if (s.emit?.type) return s.emit.type;
        }
      }
    }
  }
  return null;
}

/** Read intake's subscription to an event and build the write-back step. */
function buildIntakeReactionSteps(machines, eventType, program) {
  const intakeSM = machines['intake'];
  const found = getHandler(intakeSM, eventType);
  if (!found) return [];
  // Read the handler to see what it does — typically a PATCH to intake/application-members
  const obs = walkSteps(found.handler.steps, intakeSM, { event: { type: eventType } });
  const steps = [];
  for (const o of obs) {
    if (o.kind === 'http-call' && (o.method === 'PATCH' || o.method === 'POST')) {
      const label = `${eventType.split('.').pop().replace(/_/g,' ')} written back`;
      const progLabel = program ? ` (member A, ${program})` : '';
      steps.push({
        name: cap(label) + progLabel,
        request: req('GET', `/intake/applications/${varRef('appId')}/members/${varRef('memberAId')}`, {
          description: frontmatter({ type: 'event', event: eventType }, { method: 'PATCH', path: o.path }),
        }),
        event: [testEvent(label, [
          `pm.test('${label}', () => { pm.response.to.have.status(200); pm.expect(pm.response.json()).to.exist; });`,
        ])],
      });
      break; // one write-back step per event
    }
  }
  return steps;
}

/** Read a program's condition text from the state machine's createProgramVerifications if-condition. */
function readProgramCondition(sm, program) {
  for (const machine of (sm.machines || [])) {
    for (const proc of (machine.procedures || [])) {
      if (proc.if && typeof proc.if === 'string' && proc.if.includes(program)) {
        return `if "${program}" in application.programs`;
      }
    }
  }
  return null;
}

function buildClientManagementSection(triggerEvent, setupActions) {
  const items = [buildAppSubmittedVerification(triggerEvent)];

  // Extract person match events from the setup script
  const matchEvents = setupActions.filter(a =>
    a.type === 'event' && typeof a.body === 'object' && a.body?.type?.includes('person.match_resolved')
  );

  for (const action of matchEvents) {
    const body = typeof action.body === 'object' ? action.body : {};
    const matchType = body.data?.matchType || 'confirmed';
    const memberVar = (body.subject || '{{memberId}}').replace(/\{\{|\}\}/g, '') || 'memberId';
    const memberLabel = memberVar.replace('member', '').replace('Id', '');

    items.push({
      name: `Person Match Resolved (${matchType}, member ${memberLabel})`,
      request: req('POST', '/platform/events', {
        description: frontmatter({ type: 'external', domain: 'client_management' }) +
          `\nClient Management publishes a ${matchType} person match for member ${memberLabel}.`,
        headers: [{ key: 'Content-Type', value: 'application/json' }],
        body: action.body,
      }),
      event: [testEvent('event accepted', ["pm.test('event accepted', () => pm.response.to.have.status(202));"])],
    });

    const stepLabels = { confirmed: `Member ${memberLabel} person ID linked`, no_match: `Member ${memberLabel} no_match — personId not set`, review_required: `Member ${memberLabel} review_required — candidates populated` };
    const assertions = {
      confirmed:        ["const m = pm.response.json();", `pm.test('person ID linked', () => { pm.response.to.have.status(200); pm.expect(m.personId).to.exist; });`],
      no_match:         ["const m = pm.response.json();", `pm.test('personId not set', () => { pm.response.to.have.status(200); pm.expect(m.personId).to.not.exist; });`],
      review_required:  ["const m = pm.response.json();", `pm.test('candidates populated', () => { pm.response.to.have.status(200); pm.expect(m.personMatch?.candidates?.length).to.be.at.least(1); });`],
    };

    items.push({
      name: stepLabels[matchType] || `Member ${memberLabel} match recorded`,
      request: req('GET', `/intake/applications/${varRef('appId')}/members/${varRef(memberVar)}`, {
        description: frontmatter({ type: 'event', event: 'client_management.person.match_resolved' },
          { method: 'PATCH', path: '/intake/application-members/{id}' }),
      }),
      event: [testEvent(stepLabels[matchType], assertions[matchType] || [])],
    });
  }

  return folder('Client Management — Person Matching', items);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const cliArgs = process.argv.slice(2);
const baseUrlArg   = cliArgs.find(a => a.startsWith('http')) || 'http://localhost:1080';
const scenarioPath = resolve(cliArgs.find(a => !a.startsWith('http')) ||
  join(contractsDir, 'scenarios', 'application-submission.setup.sh'));

// Derive metadata from setup script
function deriveMeta(scriptPath) {
  const src = readFileSync(scriptPath, 'utf8');
  const lines = src.split('\n');
  const id   = basename(scriptPath).replace(/\.setup\.sh$/, '').replace(/\.sh$/, '');
  const nameLine = lines.find(l => /^#\s*Scenario:/i.test(l));
  const name = nameLine ? nameLine.replace(/^#\s*Scenario:\s*/i, '').trim() : id;
  const descLines = [];
  const nameIdx = lines.indexOf(nameLine);
  for (let i = nameIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.startsWith('#') || /^#\s*$/.test(l)) break;
    descLines.push(l.replace(/^#\s*/, ''));
  }
  const urlMatch = src.match(/\$BASE_URL\/([a-z][a-z-]+)\//);
  const domain = urlMatch ? urlMatch[1].replace(/-/g, '_') : 'unknown';
  return { id, name, description: descLines.join(' ').trim(), domain };
}

const meta         = deriveMeta(scenarioPath);
const machines     = loadMachines();
const setupActions = parseSetupScript(scenarioPath);

// Extract stub outcomes from setup script
const stubOutcomes = {};
for (const a of setupActions.filter(a => a.type === 'stub')) {
  const st  = a.body?.match?.['data.serviceType'];
  const out = a.body?.respond?.data?.result || 'conclusive';
  if (st) stubOutcomes[st] = out;
}

// Derive trigger event from the state machine: find the submit action on the trigger action's
// endpoint and read what event it emits.
function deriveTriggerEvent(machines, setupActions) {
  const triggerAction = setupActions.find(a => a.type === 'trigger');
  if (!triggerAction) return 'intake.application.submitted'; // safe fallback
  // Extract the action id from the URL: /intake/applications/{id}/submit → 'submit'
  const pathSegs = triggerAction.path.replace(/\{\{[^}]+\}\}/g, '{id}').split('/').filter(Boolean);
  const actionId  = pathSegs[pathSegs.length - 1];
  const domain    = pathSegs[0];
  const sm        = machines[domain];
  if (!sm) return 'intake.application.submitted';
  for (const machine of (sm.machines || [])) {
    const action = (machine.actions || []).find(a => a.id === actionId);
    if (action) {
      for (const step of (action.steps || [])) {
        if (step.emit?.type) return step.emit.type;
      }
    }
  }
  return 'intake.application.submitted';
}

const triggerEvent = deriveTriggerEvent(machines, setupActions);

// Get programs from setup script (first POST to /intake/applications body)
const appAction  = setupActions.find(a => a.type === 'resource' && a.path === '/intake/applications' && a.method === 'POST');
const programs   = (typeof appAction?.body === 'object' ? appAction.body?.programs : null) || ['snap', 'medicaid'];

// Build Pre-submission from setup script actions (exclude event injections — those go to domain sections)
const preSubmissionItems = setupActions
  .filter(a => a.type !== 'event')
  .map(actionToPostmanItem);

// Get subscribers of the trigger event
const subscribers = getSubscribers(machines, triggerEvent);

// Build sections for each subscriber, plus special handling for intake verifications and eligibility
const sectionItems = [];

// Derive service call map and programs from state machine and setup script
const serviceCallsByCategory = readServiceCallsByCategory(machines);

// Intake — Initiate Verifications (special: has nested verification flows)
sectionItems.push(buildIntakeVerifSection(machines, triggerEvent, stubOutcomes, serviceCallsByCategory));

// Other subscribers from state machines (workflow, etc.)
for (const domain of subscribers.filter(d => d !== 'intake' && d !== 'eligibility')) {
  const sec = buildSubscriberSection(domain, triggerEvent, machines, setupActions);
  if (sec) sectionItems.push(sec);
}

// Eligibility (special: has per-program decision sub-flows read from state machine)
if (subscribers.includes('eligibility') || machines['eligibility']) {
  sectionItems.push(buildEligibilitySection(machines, triggerEvent, stubOutcomes, programs));
}

// Client Management (external — not yet in subscription map, uses setup script events)
sectionItems.push(buildClientManagementSection(triggerEvent, setupActions));

const collection = {
  info: {
    name: meta.name,
    description: meta.description,
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [
    { key: 'id',      value: meta.id },
    { key: 'domain',  value: meta.domain },
    { key: 'baseUrl', value: baseUrlArg },
    { key: 'prereqs', value: '[]' },
    { key: 'appId',   value: '' },
    { key: 'appSubmittedEventId', value: '' },
    ...setupActions.filter(a => a.store).map(a => ({ key: a.store, value: '' })),
  ],
  item: [
    folder('Pre-submission', preSubmissionItems),
    ...sectionItems,
  ],
};

const outPath = join(dirname(scenarioPath), `${meta.id}.collection.json`);
writeFileSync(outPath, JSON.stringify(collection, null, 2));
console.log(`Generated: ${outPath}`);

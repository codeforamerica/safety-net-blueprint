/**
 * The pipeline over a realistic contract set.
 *
 * Every other test in this package exercises one function. This one runs a
 * set of related documents — a spec, its examples, a composition, a ruleset,
 * a state machine, an AsyncAPI catalog, SLA types and a state's overlay —
 * through discover → generate → resolve → validate, and asserts what comes
 * out the far end.
 *
 * It exists because the defects this refactor turned up were all of a kind
 * that single-function tests cannot see: a derived view going stale between
 * passes, an overlay silently targeting nothing, a `$ref` bound that dropped
 * every cross-file reference. Each needed two stages disagreeing to show.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import yaml from 'js-yaml';

import { discover, load, generate, extract, resolve, validate } from '../../src/index.js';

const CONTRACTS = {
  'common/schemas/shared.yaml': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $defs: {
      Domain: { enum: ['intake'] },
      Address: { type: 'object', properties: { line1: { type: 'string' } } },
    },
  },

  'domains/intake/intake-openapi.yaml': {
    openapi: '3.1.0',
    info: { title: 'Intake', version: '1.0.0', 'x-domain': 'intake' },
    paths: {
      '/applications': {
        get: { operationId: 'listApplications', responses: { 200: {} } },
        post: { operationId: 'createApplication', responses: { 201: {} } },
      },
      '/applications/{id}/submit': {
        post: {
          operationId: 'submitApplication',
          'x-relationship': { type: 'state-machine-action', domain: 'intake', id: 'submit' },
          responses: { 200: {} },
        },
      },
    },
    servers: [
      { url: 'https://api.example.com', 'x-environments': ['production'] },
      { url: 'https://dev.example.com', 'x-environments': ['dev'] },
    ],
    components: {
      examples: {
        Application1: { value: { id: 'a1', status: 'draft' } },
        Application2: { value: { id: 'a2', status: 'submitted' } },
      },
      schemas: {
        Application: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            status: { type: 'string', 'x-enum-source': 'states[].id' },
            slaTypeCode: { type: 'string', 'x-enum-source': 'slaTypes[].id' },
            address: { $ref: '../../common/schemas/shared.yaml#/$defs/Address' },
            contactEmail: { type: 'string', description: '${SUPPORT_EMAIL}' },
          },
        },
      },
    },
  },

  'domains/intake/intake-state-machine.yaml': {
    $schema: 'state-machine-schema.yaml',
    version: '1.0',
    domain: 'intake',
    apiSpec: 'intake-openapi.yaml',
    eventsSpec: 'intake-asyncapi.yaml',
    machines: [
      {
        object: 'Application',
        initialState: 'draft',
        states: [{ id: 'draft' }, { id: 'submitted' }],
        actions: [
          {
            id: 'submit',
            from: 'draft',
            to: 'submitted',
            steps: [{ emit: { type: 'intake.application.submitted', data: {} } }],
          },
        ],
      },
    ],
  },

  'domains/intake/intake-asyncapi.yaml': {
    asyncapi: '3.0.0',
    info: { title: 'Intake Events', version: '1.0.0' },
    channels: { 'intake.application.submitted': { address: 'intake.application.submitted' } },
  },

  'domains/intake/intake-sla-types.yaml': {
    $schema: 'sla-types-schema.yaml',
    version: '1.0',
    domain: 'intake',
    slaTypes: [{ id: 'snap_standard', name: 'SNAP', duration: { amount: 30, unit: 'days' } }],
  },

  'domains/intake/intake-rules.yaml': {
    $schema: 'rules-schema.yaml',
    domain: 'intake',
    rulesets: {
      expedited: {
        inputs: { household: { type: 'object', properties: { income: { type: 'number' } } } },
        outputs: { type: 'object', properties: { eligible: { type: 'boolean' } } },
        facts: [{ path: 'eligible', expression: 'household.income < 150', type: { type: 'boolean' } }],
      },
    },
  },
};

const OVERLAY = {
  overlay: '1.0.0',
  info: { title: 'Test state overlay', version: '1.0.0' },
  config: { 'x-event-type-prefix': 'ca.' },
  actions: [
    {
      target: '$.info',
      description: 'Tag the owning team',
      file: 'domains/intake/intake-openapi.yaml',
      update: { 'x-owner': 'state-team' },
    },
  ],
};

let dir;
let docs;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'pipeline-'));
  for (const [relativePath, content] of Object.entries(CONTRACTS)) {
    const full = join(dir, relativePath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, yaml.dump(content));
  }
  docs = discover(dir).map(load);
});

after(() => rmSync(dir, { recursive: true, force: true }));

describe('discover and load', () => {
  test('finds every document and types each one', () => {
    const byType = Object.fromEntries(docs.map((d) => [d.relativePath, d.type]));
    assert.equal(byType['domains/intake/intake-openapi.yaml'], 'openapi');
    assert.equal(byType['domains/intake/intake-state-machine.yaml'], 'state-machine');
    assert.equal(byType['domains/intake/intake-asyncapi.yaml'], 'asyncapi');
    assert.equal(byType['domains/intake/intake-rules.yaml'], 'rules');
    assert.equal(byType['domains/intake/intake-sla-types.yaml'], 'sla-types');
    assert.equal(byType['common/schemas/shared.yaml'], 'schema');
  });

  test('every document knows its domain', () => {
    const spec = docs.find((d) => d.type === 'openapi');
    assert.equal(spec.domain, 'intake');
  });

  test('a state machine normalizes into a walkable tree', () => {
    const sm = docs.find((d) => d.type === 'state-machine');
    const [step] = sm.model().machines[0].actions[0].steps;
    assert.equal(step.kind, 'emit');
    assert.deepEqual(step.children, []);
  });
});

describe('generate', () => {
  test('a ruleset compiles to a graph that names itself', () => {
    const [{ path, graph }] = generate(docs, 'graph');
    assert.equal(path, 'domains/intake/intake-expedited-graph.yaml');
    assert.equal(graph.ruleset, 'expedited');
    assert.equal(graph.domain, 'intake');
    assert.ok(graph.inputs['$.household.income']);
  });

  test('examples group by the schema each record exemplifies', () => {
    const grouped = generate(docs, 'examples');
    assert.deepEqual(grouped['Application'].map((r) => r.data.id).sort(), ['a1', 'a2']);
  });

  test('a state machine action projects an RPC overlay onto its spec', () => {
    const overlays = generate(docs, 'overlay');
    assert.ok(overlays.length > 0, 'at least one overlay generated');
    assert.ok(
      overlays.every((o) => (o.actions ?? []).every((a) => a.target)),
      'every action names a target'
    );
  });
});

describe('extract', () => {
  test('finds the endpoint a state machine action generated', () => {
    const index = extract(docs, 'relationships');
    assert.deepEqual(index.get('state-machine-action:intake:submit'), {
      path: '/applications/{id}/submit',
      method: 'post',
    });
  });
});

describe('resolve', () => {
  let resolved;

  before(() => {
    resolved = resolve(docs, {
      overlays: [OVERLAY, ...generate(docs, 'overlay')],
      envTarget: 'production',
      envVariables: { SUPPORT_EMAIL: 'help@example.gov' },
    });
  });

  const spec = () => resolved.docs.find((d) => d.type === 'openapi').content;

  test('applies the state overlay', () => {
    assert.equal(spec().info['x-owner'], 'state-team');
  });

  test('injects enum values from the state machine and sla types', () => {
    const props = spec().components.schemas.Application.properties;
    assert.deepEqual(props.status.enum, ['draft', 'submitted']);
    assert.deepEqual(props.slaTypeCode.enum, ['snap_standard']);
    assert.equal('x-enum-source' in props.status, false, 'annotation consumed');
  });

  test('prefixes every event type, in both the machine and the catalog', () => {
    const machine = resolved.docs.find((d) => d.type === 'state-machine').content;
    const events = resolved.docs.find((d) => d.type === 'asyncapi').content;

    assert.equal(machine.machines[0].actions[0].steps[0].emit.type, 'ca.intake.application.submitted');
    assert.ok('ca.intake.application.submitted' in events.channels);
  });

  test('filters to the target environment and strips the marker', () => {
    assert.equal(spec().servers.length, 1);
    assert.equal(spec().servers[0].url, 'https://api.example.com');
    assert.equal('x-environments' in spec().servers[0], false);
  });

  test('substitutes variables', () => {
    assert.equal(
      spec().components.schemas.Application.properties.contactEmail.description,
      'help@example.gov'
    );
  });

  test('records what it did', () => {
    assert.equal(resolved.manifest.envTarget, 'production');
    assert.deepEqual(resolved.manifest.variables, ['SUPPORT_EMAIL']);
    assert.ok(resolved.manifest.overlays.includes('Test state overlay'));
  });

  test('a resolved document reports its own state, not the one it was loaded with', () => {
    // The defect this guards: refs() and model() were fields computed at
    // load, so every pass after the first handed validate stale content.
    const machine = resolved.docs.find((d) => d.type === 'state-machine');
    const emitted = machine.model().machines[0].actions[0].steps[0];
    assert.equal(emitted.type, 'ca.intake.application.submitted');
  });

  test('leaves documents no pass touched as the same object', () => {
    const before = docs.find((d) => d.type === 'sla-types');
    const after = resolved.docs.find((d) => d.type === 'sla-types');
    assert.equal(before, after);
  });
});

describe('validate', () => {
  test('checks the resolved set and reports per document', () => {
    const resolved = resolve(docs, { overlays: generate(docs, 'overlay') });
    const result = validate(resolved.docs);

    assert.equal(typeof result.ok, 'boolean');
    assert.equal(result.results.length, resolved.docs.length);
    assert.ok(result.report.length > 0);

    for (const doc of resolved.docs) {
      assert.ok(
        result.results.some((r) => r.path === doc.path),
        `${doc.relativePath} appears in the report`
      );
    }
  });

  test('resolves a schema composed across files', () => {
    // The `$ref` bound regression: when cross-file refs were dropped, a
    // schema composed of a sibling's $defs looked like it had no properties
    // and every field reference against it was reported missing.
    const spec = docs.find((d) => d.type === 'openapi');
    const address = spec.resolveRef('../../common/schemas/shared.yaml#/$defs/Address', docs);
    assert.ok(address.properties.line1, 'sibling schema resolved');
  });
});

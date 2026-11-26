/**
 * Choosing part of a contract set that stands on its own: what it
 * references, platform by use, the scenarios that fit, and left-out types
 * made External.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { toDoc } from '../../src/doc.js';
import { detectType } from '../../src/contract-types.js';
import { selectDocs } from '../../src/select.js';
import { resolve } from '../../src/resolve.js';
import { polymorphicReferenceErrors } from '../../src/validator/polymorphic-validator.js';

const set = (tree) => Object.entries(tree).map(([relativePath, content]) => toDoc({ relativePath, type: detectType(relativePath, content), content }));
const paths = (docs) => docs.map((doc) => doc.relativePath).sort();

const openapi = (domain, schemas, extra = {}) => ({
  openapi: '3.1.0',
  info: { title: domain, version: '1.0.0', 'x-domain': domain, ...extra },
  paths: Object.fromEntries(Object.keys(schemas).map((name) => [`/${name.toLowerCase()}s/{id}`, { get: { operationId: `get${name}`, responses: { 200: { content: { 'application/json': { schema: { $ref: `#/components/schemas/${name}` } } } } } } }])),
  components: { schemas },
});

const TREE = {
  'domains/intake/intake-openapi.yaml': openapi('intake', { Interview: { type: 'object', properties: { id: { type: 'string' } } } }),
  'domains/communication/communication-transcripts-openapi.yaml': openapi('communication', {
    Transcript: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        subjectType: { type: 'string', enum: ['interview', 'call'] },
        subjectId: { type: 'string', 'x-relationship': { resource: 'Polymorphic', discriminator: { propertyName: 'subjectType', mapping: { call: 'External' } } } },
        speaker: { $ref: '../../schemas/enums.yaml#/$defs/Speaker' },
      },
    },
  }, { 'x-capability': 'transcripts' }),
  'domains/communication/communication-transcripts-events-asyncapi.yaml': {
    asyncapi: '3.0.0', info: { title: 'Transcript events', version: '1.0.0', 'x-domain': 'communication', 'x-capability': 'transcripts' }, channels: {},
  },
  'domains/communication/communication-transcripts-socket-asyncapi.yaml': {
    asyncapi: '3.0.0', info: { title: 'Socket', version: '1.0.0', 'x-domain': 'communication', 'x-capability': 'transcripts' },
    servers: { local: { host: 'localhost:1080', protocol: 'ws' } }, channels: {},
  },
  'domains/communication/communication-transcripts-state-machine.yaml': {
    $schema: 'state-machine-schema.yaml', domain: 'communication', capability: 'transcripts',
    machines: [{ object: 'Transcript', timers: [{ id: 'idle' }], states: [] }],
  },
  'schemas/enums.yaml': { $defs: { Speaker: { type: 'string' } } },
  'domains/platform/platform-events-openapi.yaml': openapi('platform', { Event: { type: 'object' } }),
  'domains/platform/platform-timers-asyncapi.yaml': { asyncapi: '3.0.0', info: { title: 'Timers', version: '1.0.0', 'x-domain': 'platform' }, channels: {} },
  'domains/platform/platform-registries-openapi.yaml': openapi('platform', { Registry: { type: 'object' } }),
  'scenarios/transcription.arazzo.yaml': {
    arazzo: '1.0.1', info: { title: 'Transcription', version: '1.0.0', 'x-domain': 'communication' },
    sourceDescriptions: [{ name: 'transcripts', url: '../domains/communication/communication-transcripts-openapi.yaml', type: 'openapi' }], workflows: [],
  },
  'scenarios/interview.arazzo.yaml': {
    arazzo: '1.0.1', info: { title: 'Interview', version: '1.0.0', 'x-domain': 'communication' },
    sourceDescriptions: [
      { name: 'intake', url: '../domains/intake/intake-openapi.yaml', type: 'openapi' },
      { name: 'transcripts', url: '../domains/communication/communication-transcripts-openapi.yaml', type: 'openapi' },
    ], workflows: [],
  },
};

describe('selectDocs', () => {
  const docs = set(TREE);

  test('keeps a capability, what it references, the platform parts it uses, and the scenarios that fit', () => {
    assert.deepEqual(paths(selectDocs(docs, { capabilities: ['transcripts'] })), [
      'domains/communication/communication-transcripts-events-asyncapi.yaml',
      'domains/communication/communication-transcripts-openapi.yaml',
      'domains/communication/communication-transcripts-socket-asyncapi.yaml',
      'domains/communication/communication-transcripts-state-machine.yaml',
      'domains/platform/platform-events-openapi.yaml',
      'domains/platform/platform-timers-asyncapi.yaml',
      'scenarios/transcription.arazzo.yaml',
      'schemas/enums.yaml',
    ]);
  });

  test('brings no part of platform nothing uses', () => {
    assert.deepEqual(paths(selectDocs(docs, { domains: ['intake'] })), ['domains/intake/intake-openapi.yaml']);
  });

  test('a registry brings the platform registries API, which serves it', () => {
    const withRegistry = set({
      ...TREE,
      'domains/intake/intake-registry-terms.yaml': { $schema: 'registry-schema.yaml', version: '1.0.0', domain: 'intake', type: 'terms', entries: {} },
    });
    assert.ok(paths(selectDocs(withRegistry, { domains: ['intake'] })).includes('domains/platform/platform-registries-openapi.yaml'));
  });

  test('a scenario never widens the choice: one calling intake is left out until intake is chosen', () => {
    assert.ok(!paths(selectDocs(docs, { capabilities: ['transcripts'] })).includes('scenarios/interview.arazzo.yaml'));
    assert.ok(paths(selectDocs(docs, { capabilities: ['transcripts'], domains: ['intake'] })).includes('scenarios/interview.arazzo.yaml'));
  });

  test('maps a type whose resource was left out to External, so the part validates on its own', () => {
    const part = selectDocs(docs, { capabilities: ['transcripts'] });
    const transcripts = part.find((doc) => doc.api === 'communication-transcripts');
    const { mapping } = transcripts.content.components.schemas.Transcript.properties.subjectId['x-relationship'].discriminator;
    assert.deepEqual(mapping, { call: 'External', interview: 'External' });
    assert.equal(polymorphicReferenceErrors(part).size, 0);
    // The set it came from is unchanged.
    assert.deepEqual(docs.find((doc) => doc.api === 'communication-transcripts').content.components.schemas.Transcript.properties.subjectId['x-relationship'].discriminator.mapping, { call: 'External' });
  });

  test('maps a relationship in an event\'s payload to External too, when its resource was left out', () => {
    const events = 'domains/communication/communication-transcripts-events-asyncapi.yaml';
    const withLink = set({
      ...TREE,
      [events]: {
        ...TREE[events],
        components: { schemas: { TranscriptCreated: { type: 'object', properties: { interviewId: { type: 'string', 'x-relationship': { resource: 'Interview' } } } } } },
      },
    });
    const part = selectDocs(withLink, { capabilities: ['transcripts'] });
    const kept = part.find((doc) => doc.relativePath === events);
    assert.equal(kept.content.components.schemas.TranscriptCreated.properties.interviewId['x-relationship'].resource, 'External');
  });

  test('keeps a schema file of the set a kept document\'s $schema names', () => {
    const withConfig = set({
      ...TREE,
      'domains/intake/intake-config.yaml': { $schema: 'intake-config-schema.yaml', domain: 'intake' },
      'domains/intake/intake-config-schema.yaml': { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' },
    });
    assert.ok(paths(selectDocs(withConfig, { domains: ['intake'] })).includes('domains/intake/intake-config-schema.yaml'));
  });

  test('keeps the type as it is when its resource was kept', () => {
    const part = selectDocs(docs, { capabilities: ['transcripts'], domains: ['intake'] });
    const transcripts = part.find((doc) => doc.api === 'communication-transcripts');
    assert.deepEqual(transcripts.content.components.schemas.Transcript.properties.subjectId['x-relationship'].discriminator.mapping, { call: 'External' });
  });

  test('a name the set doesn\'t declare is an error listing the ones it does', () => {
    assert.throws(() => selectDocs(docs, { capabilities: ['transcript'] }), /No document declares the capability transcript\. The set's capabilities: transcripts/);
    assert.throws(() => selectDocs(docs, { domains: ['intkae'] }), /No document declares the domain intkae\. The set's domains: communication, intake, platform/);
  });
});

describe('selectDocs, an API a kept one calls', () => {
  const calling = set({
    ...TREE,
    'domains/intake/intake-state-machine.yaml': {
      $schema: 'state-machine-schema.yaml', domain: 'intake',
      machines: [{ object: 'Interview', states: [], procedures: [{ id: 'flag', steps: [{ call: { operationId: 'getTranscript' } }, { call: 'notify' }] }] }],
    },
  });

  test('brings its contract with every operation answered outside, and none of its behavior', () => {
    const part = selectDocs(calling, { domains: ['intake'] });
    const transcripts = part.find((doc) => doc.api === 'communication-transcripts');
    assert.ok(transcripts, 'the called API comes along');
    for (const pathItem of Object.values(transcripts.content.paths)) {
      assert.deepEqual(pathItem.get['x-relationship'], { type: 'external' });
    }
    assert.ok(!part.some((doc) => doc.type === 'state-machine' && doc.domain === 'communication'), 'not its state machine');
  });

  test('leaves the API as it is when it was chosen too', () => {
    const transcripts = selectDocs(calling, { domains: ['intake'], capabilities: ['transcripts'] }).find((doc) => doc.api === 'communication-transcripts');
    assert.equal(Object.values(transcripts.content.paths)[0].get['x-relationship'], undefined);
  });

  test('keeps no scenario that calls it, which would only meet 501s', () => {
    assert.ok(!paths(selectDocs(calling, { domains: ['intake'] })).includes('scenarios/transcription.arazzo.yaml'));
  });
});

describe('selectDocs, an API', () => {
  // Two APIs in one domain, sharing its machine, annotations, sample records,
  // configuration and metrics files.
  const shared = set({
    'domains/case/case-openapi.yaml': openapi('case', { Case: { type: 'object', properties: { id: { type: 'string' } } } }),
    'domains/case/case-notes-openapi.yaml': openapi('case', { Note: { type: 'object', properties: { id: { type: 'string' } } } }),
    'domains/case/case-state-machine.yaml': {
      $schema: 'state-machine-schema.yaml', domain: 'case',
      machines: [
        { object: 'Case', states: [], procedures: [{ id: 'score', steps: [{ evaluate: 'priority' }] }] },
        { object: 'Note', states: [] },
      ],
    },
    'domains/case/case-rules.yaml': { $schema: 'rules-schema.yaml', domain: 'case', rulesets: { priority: {}, tone: {} } },
    'domains/case/case-annotations.yaml': {
      $schema: 'annotations-schema.yaml', version: '1.0', domain: 'case',
      schema: { 'case.id': { reason: 'a' }, 'note.id': { reason: 'b' } },
      operations: { 'case.close': { reason: 'c' }, 'note.pin': { reason: 'd' } },
      events: { 'case.case.closed': { reason: 'e' }, 'case.note.pinned': { reason: 'f' } },
      facts: { 'priority.level': { reason: 'g' }, 'tone.mood': { reason: 'h' } },
    },
    'domains/case/case-mock-data.yaml': { domain: 'case', CaseExample1: { id: 'c1' }, NoteExample1: { id: 'n1' } },
    'domains/case/case-config.yaml': {
      $schema: 'config-schema.yaml', domain: 'case',
      caseTypes: { resource: 'Case', entries: [] },
      noteKinds: { resource: 'Note', entries: [] },
    },
    'domains/case/case-metrics.yaml': {
      $schema: 'metrics-schema.yaml', domain: 'case',
      metrics: [{ id: 'open', source: { collection: 'cases' } }, { id: 'pinned', source: { collection: 'notes' } }],
    },
  });
  const part = selectDocs(shared, { apis: ['case'] });
  const at = (name) => part.find((doc) => doc.relativePath === `domains/case/case-${name}.yaml`)?.content;

  test('keeps its own document, not the other API\'s', () => {
    assert.ok(at('openapi'));
    assert.ok(!at('notes-openapi'));
  });

  test('cuts the files it shares to its resources\' entries', () => {
    assert.deepEqual(at('state-machine').machines.map((machine) => machine.object), ['Case']);
    assert.deepEqual(Object.keys(at('rules').rulesets), ['priority'], 'the ruleset its machine evaluates');
    const annotations = at('annotations');
    assert.deepEqual([annotations.schema, annotations.operations, annotations.events, annotations.facts].map(Object.keys),
      [['case.id'], ['case.close'], ['case.case.closed'], ['priority.level']]);
    assert.deepEqual(Object.keys(at('mock-data')), ['domain', 'CaseExample1']);
    assert.deepEqual(Object.keys(at('config')).filter((key) => !key.startsWith('$') && key !== 'domain'), ['caseTypes']);
    assert.deepEqual(at('metrics').metrics.map((metric) => metric.id), ['open']);
  });

  test('a document chosen whole as well stays whole', () => {
    const both = selectDocs(shared, { apis: ['case'], domains: ['case'] });
    assert.equal(both.find((doc) => doc.relativePath === 'domains/case/case-state-machine.yaml').content.machines.length, 2);
  });

  test('an unknown API is an error listing the set\'s', () => {
    assert.throws(() => selectDocs(shared, { apis: ['cases'] }), /No document declares the API cases\. The set's APIs: case, case-notes/);
  });
});

describe('resolve, choosing', () => {
  const docs = set(TREE);

  test('keeps only what was chosen, as its last pass, and says so', () => {
    const result = resolve(docs, { capabilities: ['transcripts'] });
    assert.ok(result.docs.some((doc) => doc.api === 'communication-transcripts'));
    assert.ok(!result.docs.some((doc) => doc.domain === 'intake'));
    assert.ok(result.applied.some((line) => /^Kept \d+ of \d+ documents: capability transcripts/.test(line)));
  });

  test('keeps the whole set when nothing is chosen', () => {
    assert.equal(resolve(docs).docs.length, resolve(docs, { domains: [], capabilities: [] }).docs.length);
    assert.ok(resolve(docs).docs.some((doc) => doc.domain === 'intake'));
  });

  test('follows a canonical ref to the framework\'s base contracts, which resolve places under base/', () => {
    const canonical = set({
      'domains/intake/intake-openapi.yaml': openapi('intake', { Interview: { type: 'object', properties: { kind: { $ref: 'https://blueprint.codeforamerica.org/base/schemas/enums.yaml#/$defs/Kind' } } } }),
      'base/schemas/enums.yaml': { $defs: { Kind: { type: 'string' } } },
      'base/schemas/unused.yaml': { $defs: {} },
    });
    assert.deepEqual(paths(selectDocs(canonical, { domains: ['intake'] })), ['base/schemas/enums.yaml', 'domains/intake/intake-openapi.yaml']);
  });
});

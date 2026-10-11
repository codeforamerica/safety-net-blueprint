/**
 * Unit tests for resolve/enum-sources.js
 *
 * A schema field declares that its permitted values come from a behavioral
 * contract rather than repeating them. Ported from the CLI's parseEnumSource,
 * findEnumSources, buildEnumSourceIndex and applyEnumSourceInjections tests,
 * restated against the pass API — the index and the scan are internal to it.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { injectEnumSources } from '../../../src/resolve/enum-sources.js';
import { doc } from '../../helpers/docs.js';

const slaTypes = (entries) => doc(
  { slaTypes: entries },
  { relativePath: 'domains/intake/intake-sla-types.yaml', type: 'sla-types' }
);

const stateMachine = (content) => doc(
  content,
  { relativePath: 'domains/intake/intake-state-machine.yaml', type: 'state-machine' }
);

const spec = (content) => doc(
  content,
  { relativePath: 'domains/intake/intake-openapi.yaml', type: 'openapi' }
);

/** The annotated field, after the pass. */
const field = (result) =>
  result.docs.find((d) => d.type === 'openapi').content.components.schemas.Application.properties.status;

const specWith = (annotation) => spec({
  openapi: '3.1.0',
  components: { schemas: { Application: { properties: { status: { type: 'string', 'x-enum-source': annotation } } } } },
});

describe('injectEnumSources', () => {
  test('injects sla type ids and removes the annotation', () => {
    const result = injectEnumSources([
      slaTypes([{ id: 'snap_standard' }, { id: 'medicaid_standard' }]),
      specWith('slaTypes[].id'),
    ]);

    assert.deepEqual(field(result).enum, ['snap_standard', 'medicaid_standard']);
    assert.equal('x-enum-source' in field(result), false);
    assert.equal(field(result).type, 'string');
  });

  test('injects state ids from the machines[] form', () => {
    const result = injectEnumSources([
      stateMachine({ machines: [{ object: 'Application', states: [{ id: 'draft' }, { id: 'submitted' }] }] }),
      specWith('states[].id'),
    ]);

    assert.deepEqual(field(result).enum, ['draft', 'submitted']);
  });

  test('injects state ids from the top-level states form', () => {
    // Some machines declare states at the document level rather than under a
    // machine; both feed the flat `states` key.
    const result = injectEnumSources([
      stateMachine({ states: [{ id: 'open' }, { id: 'closed' }] }),
      specWith('states[].id'),
    ]);

    assert.deepEqual(field(result).enum, ['open', 'closed']);
  });

  test('the string form takes every machine\'s states', () => {
    const result = injectEnumSources([
      stateMachine({
        machines: [
          { object: 'Application', states: [{ id: 'draft' }] },
          { object: 'Member', states: [{ id: 'active' }] },
        ],
      }),
      specWith('states[].id'),
    ]);

    assert.deepEqual(field(result).enum, ['draft', 'active']);
  });

  test('the object form scopes to one machine', () => {
    const result = injectEnumSources([
      stateMachine({
        machines: [
          { object: 'Application', states: [{ id: 'draft' }, { id: 'submitted' }] },
          { object: 'Member', states: [{ id: 'active' }] },
        ],
      }),
      specWith({ source: 'states[].id', machine: 'Member' }),
    ]);

    assert.deepEqual(field(result).enum, ['active']);
  });

  test('reaches an annotation nested inside allOf', () => {
    // Composed schemas put them here, which a top-level-only scan would miss.
    const result = injectEnumSources([
      slaTypes([{ id: 'snap_standard' }]),
      spec({
        components: {
          schemas: {
            Application: {
              allOf: [
                { $ref: '#/components/schemas/ApplicationWritable' },
                { properties: { slaTypeCode: { 'x-enum-source': 'slaTypes[].id' } } },
              ],
            },
          },
        },
      }),
    ]);

    const composed = result.docs.find((d) => d.type === 'openapi').content
      .components.schemas.Application.allOf[1].properties.slaTypeCode;
    assert.deepEqual(composed.enum, ['snap_standard']);
  });

  // ---------------------------------------------------------------------------
  // Annotations that cannot be resolved
  //
  // Each leaves the annotation in place rather than writing an empty enum — an
  // empty enum permits nothing and fails far from the cause.
  // ---------------------------------------------------------------------------

  test('warns and keeps the annotation when the machine name is unknown', () => {
    const result = injectEnumSources([
      stateMachine({ machines: [{ object: 'Application', states: [{ id: 'draft' }] }] }),
      specWith({ source: 'states[].id', machine: 'Nonexistent' }),
    ]);

    assert.equal(field(result).enum, undefined);
    assert.ok('x-enum-source' in field(result));
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /machine: Nonexistent/);
  });

  test('warns and keeps the annotation when the collection has no values', () => {
    const result = injectEnumSources([
      slaTypes([{ id: 'snap_standard' }]),
      specWith('states[].id'),
    ]);

    assert.equal(field(result).enum, undefined);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /no values found for "states"/);
  });

  test('warns on invalid source syntax', () => {
    const result = injectEnumSources([
      slaTypes([{ id: 'snap_standard' }]),
      specWith('not valid syntax'),
    ]);

    assert.equal(field(result).enum, undefined);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /invalid syntax/);
  });

  test('warns when the object form gives no source', () => {
    const result = injectEnumSources([
      slaTypes([{ id: 'snap_standard' }]),
      specWith({ machine: 'Application' }),
    ]);

    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /no source given/);
  });

  test('names the document a warning came from', () => {
    const result = injectEnumSources([
      slaTypes([{ id: 'snap_standard' }]),
      specWith('states[].id'),
    ]);

    assert.match(result.warnings[0], /intake-openapi\.yaml/);
  });

  // ---------------------------------------------------------------------------
  // Pass contract
  // ---------------------------------------------------------------------------

  test('no source contracts in the set is a no-op', () => {
    const input = [specWith('slaTypes[].id')];
    const result = injectEnumSources(input);

    assert.equal(result.docs, input);
    assert.deepEqual(result.applied, []);
    assert.deepEqual(result.warnings, []);
  });

  test('a document with no annotations is returned unchanged', () => {
    const untouched = spec({ openapi: '3.1.0', paths: {} });
    const result = injectEnumSources([slaTypes([{ id: 'snap_standard' }]), untouched]);

    assert.equal(result.docs[1], untouched);
    assert.deepEqual(result.applied, []);
  });

  test('reports how many enums it injected, per document', () => {
    const result = injectEnumSources([
      slaTypes([{ id: 'snap_standard' }]),
      spec({
        components: {
          schemas: {
            Application: { properties: { status: { 'x-enum-source': 'slaTypes[].id' } } },
            Member: { properties: { status: { 'x-enum-source': 'slaTypes[].id' } } },
          },
        },
      }),
    ]);

    assert.equal(result.applied.length, 1);
    assert.match(result.applied[0], /Injected 2 enum\(s\).*intake-openapi\.yaml/);
  });

  test('entries without an id are skipped', () => {
    const result = injectEnumSources([
      slaTypes([{ id: 'snap_standard' }, { name: 'no id here' }, { id: 'medicaid_standard' }]),
      specWith('slaTypes[].id'),
    ]);

    assert.deepEqual(field(result).enum, ['snap_standard', 'medicaid_standard']);
  });
});

describe('injectEnumSources — the domains the set defines', () => {
  const declaring = (relativePath, type, domain) => doc(
    type === 'openapi' || type === 'asyncapi'
      ? { [type]: '3.0.0', info: { title: domain, version: '1.0.0', 'x-domain': domain } }
      : { domain },
    { relativePath, type, domain }
  );

  const enums = doc(
    { $defs: { Domain: { type: 'string', 'x-enum-source': 'domains' } } },
    { relativePath: 'base/schemas/enums.yaml', type: 'schema' }
  );

  const domainEnum = (result) =>
    result.docs.find((d) => d.relativePath === 'base/schemas/enums.yaml').content.$defs.Domain;

  test('every domain an OpenAPI, AsyncAPI or rules document declares, sorted', () => {
    const result = injectEnumSources([
      declaring('domains/workflow/workflow-openapi.yaml', 'openapi', 'workflow'),
      declaring('domains/intake/intake-asyncapi.yaml', 'asyncapi', 'intake'),
      declaring('domains/screening/screening-rules.yaml', 'rules', 'screening'),
      enums,
    ]);

    assert.deepEqual(domainEnum(result).enum, ['intake', 'screening', 'workflow']);
    assert.equal('x-enum-source' in domainEnum(result), false);
  });

  test('a document that only attaches to a domain adds none', () => {
    // A misspelled domain on mock data must not become a value of the enum;
    // validation reports it instead.
    const result = injectEnumSources([
      declaring('domains/intake/intake-openapi.yaml', 'openapi', 'intake'),
      declaring('domains/intake/intake-mock-data.yaml', 'mock-data', 'intkae'),
      enums,
    ]);

    assert.deepEqual(domainEnum(result).enum, ['intake']);
  });

  test('a set defining no domain leaves the annotation, and no enum', () => {
    const result = injectEnumSources([enums]);

    assert.equal(domainEnum(result)['x-enum-source'], 'domains');
    assert.equal('enum' in domainEnum(result), false);
  });

  test('a set defining domains but nothing else to draw on still warns where one is missing', () => {
    const result = injectEnumSources([
      declaring('domains/intake/intake-openapi.yaml', 'openapi', 'intake'),
      doc({ $defs: { Status: { type: 'string', 'x-enum-source': 'slaTypes[].id' } } },
        { relativePath: 'common/schemas/status.yaml', type: 'schema' }),
    ]);

    assert.match(result.warnings.join('\n'), /no values found for "slaTypes"/);
  });
});

describe('injectEnumSources — states named without a machine', () => {
  test('come from the annotated document\'s own domain, whichever state machine was read last', () => {
    // A set's workflow machine, then a framework machine in another domain
    // read after it. The workflow schema names no machine, and must still get
    // workflow's states.
    const workflow = doc(
      { domain: 'workflow', machines: [{ object: 'Task', states: [{ id: 'pending' }, { id: 'completed' }] }] },
      { relativePath: 'domains/workflow/workflow-state-machine.yaml', type: 'state-machine' }
    );
    const transcripts = doc(
      { domain: 'platform', machines: [{ object: 'Transcript', states: [{ id: 'recording' }, { id: 'closed' }] }] },
      { relativePath: 'base/domains/platform/platform-transcripts-state-machine.yaml', type: 'state-machine' }
    );
    const schema = doc(
      { domain: 'workflow', $defs: { Task: { properties: { status: { type: 'string', 'x-enum-source': 'states[].id' } } } } },
      { relativePath: 'domains/workflow/workflow-schema.yaml', type: 'schema' }
    );

    const result = injectEnumSources([workflow, transcripts, schema]);
    const status = result.docs.find((d) => d.relativePath === 'domains/workflow/workflow-schema.yaml').content.$defs.Task.properties.status;
    assert.deepEqual(status.enum, ['pending', 'completed']);
  });
});

describe('injectEnumSources — registry source', () => {
  const registry = (relativePath, type, ids) => doc(
    { type, domain: 'transcription', entries: Object.fromEntries(ids.map((id) => [id, { description: id }])) },
    { relativePath, type: 'registry' }
  );

  const api = doc(
    { components: { schemas: { TranscriptWritable: { properties: { provider: { type: 'string', 'x-enum-source': { registry: 'transcription-services' } } } } } } },
    { relativePath: 'base/domains/transcription/transcription-transcripts-openapi.yaml', type: 'openapi' }
  );

  const providers = (result) => result.docs
    .find((d) => d.type === 'openapi').content.components.schemas.TranscriptWritable.properties.provider;

  test('pools the entry ids of every registry of the type, sorted', () => {
    // The framework's providers, and a state's own in a file of its own.
    const result = injectEnumSources([
      registry('base/domains/transcription/transcription-registry-transcription-services.yaml', 'transcription-services', ['elevenlabs-scribe', 'aws-transcribe']),
      registry('domains/transcription/state-registry-transcription-services.yaml', 'transcription-services', ['state-vendor']),
      api,
    ]);

    assert.deepEqual(providers(result).enum, ['aws-transcribe', 'elevenlabs-scribe', 'state-vendor']);
    assert.equal('x-enum-source' in providers(result), false);
  });

  test('takes only the named type', () => {
    const result = injectEnumSources([
      registry('a-registry-transcription-services.yaml', 'transcription-services', ['aws-transcribe']),
      registry('a-registry-policies.yaml', 'policies', ['snap-clock']),
      api,
    ]);
    assert.deepEqual(providers(result).enum, ['aws-transcribe']);
  });

  test('a type no registry declares warns and leaves the annotation', () => {
    const result = injectEnumSources([registry('a-registry-policies.yaml', 'policies', ['snap-clock']), api]);
    assert.equal(providers(result)['x-enum-source'].registry, 'transcription-services');
    assert.match(result.warnings.join('\n'), /no registry entries of type "transcription-services"/);
  });
});

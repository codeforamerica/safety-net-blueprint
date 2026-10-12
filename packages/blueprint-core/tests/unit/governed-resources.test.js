/**
 * A state machine guards the creation of its own object and of resources
 * nested under it, declared under `resources:` with the guard clauses actions
 * take.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { toDoc } from '../../src/doc.js';
import { validate } from '../../src/validate.js';

const returns = (schema) => ({
  get: { responses: { 200: { content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } } } } },
});

const transcripts = toDoc({
  path: '/set/domains/transcription/transcription-openapi.yaml',
  relativePath: 'domains/transcription/transcription-openapi.yaml',
  type: 'openapi',
  content: {
    openapi: '3.1.0',
    info: { title: 'Transcripts', version: '1.0.0', 'x-domain': 'transcription' },
    servers: [{ url: '/transcription' }],
    paths: {
      '/transcripts/{transcriptId}': returns('Transcript'),
      '/transcripts/{transcriptId}/entries/{entryId}': returns('TranscriptEntry'),
      '/transcripts/{transcriptId}/entries/{entryId}/notes/{noteId}': returns('EntryNote'),
      '/speakers/{speakerId}': returns('Speaker'),
    },
  },
});

const roles = toDoc({
  path: '/set/base/schemas/enums.yaml',
  relativePath: 'base/schemas/enums.yaml',
  type: 'schema',
  content: { $defs: { RoleType: { type: 'string', enum: ['staff', 'system'] } } },
});

const machine = (resources, guards = [{ id: 'recording', condition: 'object.status == "recording"' }]) => toDoc({
  path: '/set/domains/transcription/transcription-state-machine.yaml',
  relativePath: 'domains/transcription/transcription-state-machine.yaml',
  type: 'state-machine',
  content: {
    $schema: 'state-machine-schema.yaml',
    version: '1.0',
    domain: 'transcription',
    machines: [{ object: 'Transcript', states: [{ id: 'recording', slaClock: 'running' }], initialState: 'recording', guards, resources }],
  },
});

const errorsOf = (doc, rule) => validate([transcripts, roles, doc]).results
  .flatMap((r) => r.errors)
  .filter((e) => e.rule === rule);

describe('resources a machine governs', () => {
  test('may be nested under its object at any depth', () => {
    const doc = machine({
      TranscriptEntry: { create: { guards: [{ conditions: ['recording'] }] } },
      EntryNote: { create: { guards: [{ conditions: ['recording'] }] } },
    });
    assert.deepEqual(errorsOf(doc, 'resource-not-nested'), []);
  });

  test('may be its own object', () => {
    const doc = machine({ Transcript: { create: { guards: [{ conditions: ['recording'] }] } } });
    assert.deepEqual(errorsOf(doc, 'resource-not-nested'), []);
  });

  test('may not be a resource outside its object', () => {
    const [error] = errorsOf(machine({ Speaker: { create: { guards: [{ conditions: ['recording'] }] } } }), 'resource-not-nested');
    assert.match(error.message, /governs "Speaker", which is not a resource nested under Transcript \(nested: TranscriptEntry, EntryNote\)/);
  });

  test('have their update guards checked too', () => {
    const doc = machine({ TranscriptEntry: { update: { guards: [{ actors: ['clerk'] }] } } });
    assert.match(errorsOf(doc, 'invalid-actor-role')[0].path, /resources\[TranscriptEntry\]\.update\.guards/);
  });

  test('have their guard clauses checked as an action\'s are', () => {
    const doc = machine({ TranscriptEntry: { create: { guards: [{ actors: ['clerk'], conditions: ['undeclared'] }] } } });
    assert.match(errorsOf(doc, 'invalid-actor-role')[0].path, /resources\[TranscriptEntry\]\.create\.guards/);
    assert.equal(errorsOf(doc, 'unknown-guard').length, 1);
  });
});

describe('the state machine schema', () => {
  const withBinding = (where) => machine({
    TranscriptEntry: {
      create: {
        context: [{ openPause: { from: 'transcription/transcripts/entries', where } }],
        guards: [{ conditions: ['recording'] }],
      },
    },
  });

  test('accepts resources, and a CEL string as a binding\'s where', () => {
    assert.deepEqual(errorsOf(withBinding('item.kind == "pause" && item.endedAt == null'), 'schema-conformance'), []);
  });

  test('still refuses a where that is neither an object nor a string', () => {
    assert.ok(errorsOf(withBinding(42), 'schema-conformance').length > 0);
  });
});

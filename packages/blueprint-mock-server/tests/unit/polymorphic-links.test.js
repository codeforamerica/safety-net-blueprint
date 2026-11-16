/**
 * A polymorphic reference declared links-only gets a link to the record its
 * type field names, found record by record, including inside a record a
 * response holds, like each evidence entry of a suggestion, and on a resource
 * that is a oneOf of kinds.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLinksFields, applyLinks } from '../../src/handlers/expand-utils.js';

const ENTRY = 'e1';
const TRANSCRIPT = 't1';

// Where each resource is kept and read, as a mock's resource index has it.
const resources = {
  collections: new Map([['TranscriptEntry', 'transcript-entries'], ['Document', 'documents']]),
  itemPaths: new Map([
    ['TranscriptEntry', { path: '/communication/transcripts/{transcriptId}/entries/{entryId}', parameter: 'entryId' }],
    ['Document', { path: '/documents/{documentId}', parameter: 'documentId' }],
  ]),
};

const lookup = (collection, id) =>
  collection === 'transcript-entries' && id === ENTRY ? { id: ENTRY, transcriptId: TRANSCRIPT } : null;

const evidence = {
  type: 'object',
  properties: {
    sourceType: { type: 'string' },
    sourceId: {
      type: 'string',
      'x-relationship': { resource: 'Polymorphic', discriminator: { propertyName: 'sourceType', mapping: { file: 'Document' } }, style: 'links-only' },
    },
  },
};
// A suggestion is one of two kinds, each holding a list of evidence.
const suggestion = {
  oneOf: [
    { allOf: [{ type: 'object', properties: { evidence: { type: 'array', items: evidence } } }] },
    { allOf: [{ type: 'object', properties: { kind: { type: 'string' } } }] },
  ],
};

test('each evidence entry links to the record its type names, by name or through the mapping', () => {
  const fields = extractLinksFields(suggestion, undefined, resources);
  const linked = applyLinks({
    id: 's1',
    evidence: [
      { sourceType: 'transcript_entry', sourceId: ENTRY },
      { sourceType: 'file', sourceId: 'd1' },
    ],
  }, fields, lookup, resources);

  assert.equal(linked.evidence[0].links.source, `/communication/transcripts/${TRANSCRIPT}/entries/${ENTRY}`);
  assert.equal(linked.evidence[1].links.source, '/documents/d1');
  assert.equal(linked.links, undefined, 'the suggestion itself has no reference to link');
});

test('no link when the type names nothing served, or the parent id cannot be found', () => {
  const fields = extractLinksFields(suggestion, undefined, resources);
  const linked = applyLinks({
    evidence: [
      { sourceType: 'meeting_note', sourceId: 'm1' },
      { sourceType: 'transcript_entry', sourceId: 'missing' },
    ],
  }, fields, lookup, resources);

  assert.equal(linked.evidence[0].links, undefined);
  assert.equal(linked.evidence[1].links, undefined);
});

test('a polymorphic reference with no style gets no link', () => {
  const plain = structuredClone(evidence);
  delete plain.properties.sourceId['x-relationship'].style;
  assert.deepEqual(extractLinksFields(plain, undefined, resources), []);
});

test('links need the resource index, so a caller that forgets it is told', () => {
  assert.throws(() => extractLinksFields(suggestion), /resource index/);
  assert.throws(() => applyLinks({ id: 's1' }, [], lookup), /resource index/);
});

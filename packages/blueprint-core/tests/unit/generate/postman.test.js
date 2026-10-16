/**
 * Unit tests for the Postman collection builder.
 *
 * Requests are filled with the records a mock seeds from the same set, so
 * each id names a record the mock holds. The fixture is an API under a base
 * path with two resources whose schema names share a prefix — `Transcript`,
 * `TranscriptEntry`, `TranscriptionProfile` — which is what a name-guessing
 * match got wrong: every resource fell under the base path's one folder, and
 * the profile example was used for transcripts.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { discover, load, generate } from '../../../src/index.js';

const json = (schema) => ({ content: { 'application/json': { schema } } });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const list = (name) => ({
  allOf: [
    { type: 'object', properties: { total: { type: 'integer' } } },
    { type: 'object', properties: { items: { type: 'array', items: ref(name) } } },
  ],
});

const API = {
  openapi: '3.1.0',
  info: { title: 'Transcripts', version: '1.0.0', 'x-domain': 'communication' },
  servers: [{ url: 'http://localhost:1080/communication' }],
  paths: {
    '/transcripts': {
      get: { responses: { 200: json(ref('TranscriptList')) } },
      post: { responses: { 201: json(ref('Transcript')) } },
    },
    '/transcripts/{transcriptId}': {
      get: { responses: { 200: json(ref('Transcript')) } },
      delete: { responses: { 204: { description: 'gone' } } },
    },
    '/transcripts/{transcriptId}/entries': {
      get: { responses: { 200: json(ref('TranscriptEntryList')) } },
    },
    '/transcripts/{transcriptId}/entries/{entryId}': {
      get: { responses: { 200: json(ref('TranscriptEntry')) } },
    },
    '/profiles': {
      get: { responses: { 200: json(ref('TranscriptionProfileList')) } },
    },
    '/profiles/{profileId}': {
      get: { responses: { 200: json(ref('TranscriptionProfile')) } },
      delete: { responses: { 204: { description: 'gone' } } },
    },
  },
  components: {
    schemas: {
      Transcript: { type: 'object', properties: { id: { type: 'string' }, profileId: { type: 'string' } } },
      TranscriptList: list('Transcript'),
      TranscriptEntry: { type: 'object', properties: { id: { type: 'string' }, transcriptId: { type: 'string' } } },
      TranscriptEntryList: list('TranscriptEntry'),
      TranscriptionProfile: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
      TranscriptionProfileList: list('TranscriptionProfile'),
    },
  },
};

const FILES = {
  'communication-transcripts-openapi.yaml': API,
  'communication-mock-data.yaml': {
    domain: 'communication',
    TranscriptExample1: { id: 't1', profileId: 'p1' },
    TranscriptEntryExample1: { id: 'e1', transcriptId: 't1' },
  },
  'communication-config.yaml': {
    version: '1.0',
    domain: 'communication',
    profiles: { resource: 'TranscriptionProfile', entries: [{ id: 'p1', name: 'english' }] },
  },
};

describe('generate(docs, "postman")', () => {
  let dir;
  let folders;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'postman-'));
    for (const [name, content] of Object.entries(FILES)) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, name), yaml.dump(content));
    }
    const collection = generate(discover(dir).map(load), 'postman', { baseUrl: 'http://example.test' });
    folders = Object.fromEntries(collection.item.map((folder) => [folder.name, folder.item]));
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  const urls = (requests, method) => requests
    .filter((r) => r.request.method === method)
    .map((r) => r.request.url.raw.replace('{{baseUrl}}', ''));

  test('a resource under a base path gets its own folder', () => {
    // Not one folder named after the base path every endpoint shares.
    assert.deepEqual(Object.keys(folders).sort(), ['Profiles', 'Transcripts']);
  });

  test("each resource's requests use its own schema's records", () => {
    assert.ok(urls(folders.Transcripts, 'GET').includes('/communication/transcripts/t1'));
    assert.ok(urls(folders.Profiles, 'GET').includes('/communication/profiles/p1'));
    assert.ok(!urls(folders.Transcripts, 'GET').some((url) => url.includes('p1')),
      'a profile must not be used for a transcript');
  });

  test('a nested record is addressed under the parent it belongs to', () => {
    const gets = urls(folders.Transcripts, 'GET');
    assert.ok(gets.includes('/communication/transcripts/t1/entries/e1'));
    assert.ok(!gets.includes('/communication/transcripts/e1/entries'),
      'a sub-collection list is not a get-by-id');

    const entriesList = folders.Transcripts.find((r) => r.request.url.raw.endsWith('/t1/entries'));
    assert.match(entriesList.name, /^List/);
  });

  test('a create body is a seeded record, in the shape the API takes', () => {
    // A seed is stored under the key, as a client sends it — not with the
    // related record expanded inline, as a read returns it.
    const create = folders.Transcripts.find((r) => r.request.method === 'POST');
    assert.deepEqual(JSON.parse(create.request.body.raw), { profileId: 'p1' });
  });

  test('a config catalog entry is not deleted', () => {
    // The mock refuses: config-managed records answer 409.
    assert.deepEqual(urls(folders.Profiles, 'DELETE'), []);
    assert.deepEqual(urls(folders.Transcripts, 'DELETE'), ['/communication/transcripts/t1']);
  });
});

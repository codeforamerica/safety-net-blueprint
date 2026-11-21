import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { entryFor, entryName } from '../../src/try-it/routing.js';

const adapter = { operationId: 'issueTranscriptConnection', api: 'communication-transcripts-audio-adapter', domain: 'communication' };
const transcripts = { operationId: 'createTranscript', api: 'communication-transcripts', domain: 'communication' };

describe('entryFor', () => {
  it('finds no entry when nothing is routed', () => {
    assert.equal(entryFor([], adapter), null);
  });

  it('picks the narrowest entry: an operation over an API, an API over a domain, a domain over *', () => {
    const everything = { domain: '*', to: 'https://staging.example' };
    const domain = { domain: 'communication', to: 'https://communication.example' };
    const api = { api: 'communication-transcripts-audio-adapter', handler: () => {} };
    const operation = { operation: 'issueTranscriptConnection', to: 'https://adapter.example' };
    assert.equal(entryFor([everything, domain, api, operation], adapter), operation);
    assert.equal(entryFor([everything, domain, api], adapter), api);
    assert.equal(entryFor([everything, domain], adapter), domain);
    assert.equal(entryFor([everything], adapter), everything);
  });

  it('takes an operation named with its API', () => {
    const qualified = { operation: '$apis.communication-transcripts-audio-adapter.issueTranscriptConnection', to: 'https://adapter.example' };
    assert.equal(entryFor([qualified], adapter), qualified);
  });

  it('leaves in the page what an entry excepts', () => {
    const domain = { domain: 'communication', to: 'https://communication.example', except: [{ api: 'communication-transcripts' }] };
    assert.equal(entryFor([domain], transcripts), null);
    assert.equal(entryFor([domain], adapter), domain);
  });
});

describe('entryName', () => {
  it('names an entry by what it covers', () => {
    assert.equal(entryName({ api: 'intake' }), 'intake');
    assert.equal(entryName({ operation: 'claimTask' }), 'claimTask');
    assert.equal(entryName({ domain: '*' }), '*');
  });
});

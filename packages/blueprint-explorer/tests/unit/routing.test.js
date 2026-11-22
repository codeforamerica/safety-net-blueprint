import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { entryFor, entryName, routingInUse, chooseServer, switchEntry, environmentsOf, destinationOf, awayFrom } from '../../src/try-it/routing.js';

const adapter = { operationId: 'requestCredentials', api: 'communication-transcription-sessions-adapter', domain: 'communication' };
const transcripts = { operationId: 'createTranscript', api: 'communication-transcripts', domain: 'communication' };

describe('entryFor', () => {
  it('finds no entry when nothing is routed', () => {
    assert.equal(entryFor([], adapter), null);
  });

  it('picks the narrowest entry: an operation over an API, an API over a domain, a domain over *', () => {
    const everything = { domain: '*', to: 'https://staging.example' };
    const domain = { domain: 'communication', to: 'https://communication.example' };
    const api = { api: 'communication-transcription-sessions-adapter', handler: () => {} };
    const operation = { operation: 'requestCredentials', to: 'https://adapter.example' };
    assert.equal(entryFor([everything, domain, api, operation], adapter), operation);
    assert.equal(entryFor([everything, domain, api], adapter), api);
    assert.equal(entryFor([everything, domain], adapter), domain);
    assert.equal(entryFor([everything], adapter), everything);
  });

  it('takes an operation named with its API', () => {
    const qualified = { operation: '$apis.communication-transcription-sessions-adapter.requestCredentials', to: 'https://adapter.example' };
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

describe('a server chosen in the page', () => {
  // The tab's storage and the site's routing, as a page has them.
  const stored = new Map();
  globalThis.sessionStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };
  const where = { scope: 'test' };
  const api = (name, domain, servers) => ({ type: 'openapi', api: name, domain, protocols: ['http'], content: { servers } });
  const docs = [
    api('intake', 'intake', [{ url: 'https://api.example.org/intake', description: 'Production server' }, { url: 'http://localhost:1080/intake', description: 'Local development server' }]),
    api('communication-transcription-sessions-adapter', 'communication', [{ url: 'https://{state}.adapter.example.org', description: 'Production server', variables: { state: { default: 'ca' } } }, { url: 'http://localhost:9090', description: 'Local development server' }]),
    { type: 'asyncapi', api: 'communication-transcripts-relay', domain: 'communication', protocols: ['ws'], content: {} },
  ];
  const reset = () => { stored.clear(); globalThis.BlueprintExplorer = { routing: [] }; };

  it('adds nothing until one is chosen', () => {
    reset();
    assert.deepEqual(routingInUse(where, docs), []);
  });

  it('sends every call to a URL typed in, but sockets, and leaves the site\'s narrower entries to win', () => {
    reset();
    const site = { api: 'communication-transcription-sessions-adapter', to: 'https://adapter.example.org' };
    globalThis.BlueprintExplorer.routing = [site];
    chooseServer(where, { url: 'http://localhost:1081' });
    const routing = routingInUse(where, docs);
    const everything = routing.find((entry) => entry.domain === '*');
    assert.equal(everything.to, 'http://localhost:1081');
    assert.deepEqual(everything.except, [{ api: 'communication-transcripts-relay' }]);
    assert.equal(entryFor(routing, { api: 'communication-transcription-sessions-adapter', domain: 'communication' }), site);
    assert.equal(entryFor(routing, { api: 'intake', domain: 'intake' }), everything);
  });

  it('keeps in the page what the site\'s entry was switched to', () => {
    reset();
    const site = { api: 'communication-transcription-sessions-adapter', to: 'https://adapter.example.org' };
    globalThis.BlueprintExplorer.routing = [site];
    switchEntry(where, site, true);
    chooseServer(where, { url: 'http://localhost:1081' });
    assert.equal(entryFor(routingInUse(where, docs), { api: 'communication-transcription-sessions-adapter', domain: 'communication' }), null);
  });

  it('sends each API to its own server for an environment, its variables filled in', () => {
    reset();
    chooseServer(where, { environment: 'Production server', variables: { state: 'ny' } });
    const routing = routingInUse(where, docs);
    assert.deepEqual(routing.map((entry) => [entry.api, destinationOf(entry), typeof entry.handler]), [
      ['intake', 'https://api.example.org/intake', 'function'],
      ['communication-transcription-sessions-adapter', 'https://ny.adapter.example.org', 'function'],
    ]);
    assert.equal(awayFrom(where, docs), 'https://api.example.org, https://ny.adapter.example.org');
  });

  it('names nothing away when the server is this machine', () => {
    reset();
    chooseServer(where, { environment: 'Local development server' });
    assert.equal(awayFrom(where, docs), null);
  });

  it('sends an environment only the headers the API\'s contract declares', async () => {
    reset();
    const declaring = {
      type: 'openapi', api: 'cases', domain: 'cases', protocols: ['http'],
      content: {
        servers: [{ url: 'https://cases.example.org', description: 'Production server' }],
        paths: { '/cases': { post: { parameters: [{ $ref: '#/components/parameters/Key' }] } } },
        components: {
          parameters: { Key: { name: 'Idempotency-Key', in: 'header' } },
          securitySchemes: { bearer: { type: 'http', scheme: 'bearer' }, key: { type: 'apiKey', in: 'header', name: 'X-API-Key' } },
        },
      },
    };
    chooseServer(where, { environment: 'Production server' });
    const [entry] = routingInUse(where, [declaring]);
    let sent;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => { sent = { url, headers: Object.fromEntries(init.headers) }; return new Response('{}'); };
    try {
      await entry.handler(new Request('http://mock.invalid/cases', {
        method: 'POST',
        body: '{}',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'k1', Authorization: 'Bearer t', 'X-API-Key': 'a', 'X-Caller-Id': 'worker-1', 'X-Caller-Roles': 'caseworker' },
      }));
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(sent.url, 'https://cases.example.org/cases');
    assert.deepEqual(Object.keys(sent.headers).sort(), ['authorization', 'content-type', 'idempotency-key', 'x-api-key']);
  });

  it('lists the environments the contracts\' servers name', () => {
    assert.deepEqual(environmentsOf(docs).map((e) => [e.description, e.apis.length, Object.keys(e.variables)]),
      [['Production server', 2, ['state']], ['Local development server', 2, []]]);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { discover, load } from '@codeforamerica/blueprint-core';
import { schemeFor, anyScheme } from '../../src/try-it/sign-in.js';

const here = dirname(fileURLToPath(import.meta.url));
// The harness overlays the shared bearer scheme to OAuth 2.0, naming its stand-in provider.
const docs = discover(join(here, '../../../blueprint-harness/generated/resolved')).map(load);
const adapter = docs.find((d) => d.type === 'openapi' && d.api === 'communication-transcription-sessions-adapter');
const operation = (id) => Object.values(adapter.content.paths).flatMap((item) => Object.values(item)).find((o) => o?.operationId === id);

describe('which calls need signing in', () => {
  it('is an operation requiring a scheme that says how to sign in', () => {
    const scheme = schemeFor(adapter, operation('requestCredentials'), docs);
    assert.equal(scheme.type, 'oauth2');
    assert.equal(scheme.flows.implicit.authorizationUrl, 'pages/fake-sign-in.html');
  });

  it('is not an operation that requires none', () => {
    assert.equal(schemeFor(adapter, operation('startStream'), docs), null);
  });

  it('is not one whose scheme says no way to sign in, such as a plain bearer token', () => {
    const bearer = { ...adapter, content: { ...adapter.content, components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } } } };
    assert.equal(schemeFor(bearer, operation('requestCredentials'), docs), null);
  });

  it('finds a scheme to sign in with for the control panel', () => {
    assert.equal(anyScheme(docs)?.type, 'oauth2');
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { discover, load, applyEnvironment } from '@codeforamerica/blueprint-core';
import { parseEnvFile } from '../../src/lib/environments.js';
import { schemeFor, anyScheme } from '../../src/try-it/sign-in.js';

const here = dirname(fileURLToPath(import.meta.url));
const harness = join(here, '../../../blueprint-harness');
// The harness's local contracts, which identify callers by X-Caller-Id, and
// its production environment applied, as the explorer applies it when it's
// picked: OAuth 2.0, through its stand-in sign-in page.
const local = discover(join(harness, 'generated/resolved')).map(load);
const docs = applyEnvironment(local, {
  overlays: [yaml.load(readFileSync(join(harness, 'environments/production.overlay.yaml'), 'utf8'))],
  envVariables: parseEnvFile(readFileSync(join(harness, 'environments/production.env'), 'utf8')),
}).docs;
const adapter = docs.find((d) => d.type === 'openapi' && d.api === 'communication-transcription-sessions-adapter');
const operation = (id) => Object.values(adapter.content.paths).flatMap((item) => Object.values(item)).find((o) => o?.operationId === id);

describe('which calls need signing in', () => {
  it('is none, in an environment that only names its callers, as the harness\'s local one does', () => {
    assert.equal(anyScheme(local), null);
  });

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

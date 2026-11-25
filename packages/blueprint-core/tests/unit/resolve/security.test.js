/**
 * Unit tests for resolve/security.js
 *
 * Every domain API requires the shared schemes the environment has left, as
 * alternatives, with a $ref to each; an operation naming the default means
 * the caller's sign-in and gets the same; an adapter's API gets none of its
 * own.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { requireSignIn } from '../../../src/resolve/security.js';
import { doc } from '../../helpers/docs.js';

const SHARED = 'https://blueprint.codeforamerica.org/base/components/security-schemes.yaml';
const schemes = (content) => doc(content, { relativePath: 'base/components/security-schemes.yaml', type: 'unknown' });
const api = (extra = {}) => doc({ openapi: '3.1.0', info: { title: 'Intake', version: '1', 'x-domain': 'intake' }, paths: { '/applications': { get: { operationId: 'listApplications' } } }, ...extra }, { relativePath: 'domains/intake/intake-openapi.yaml' });
const adapter = () => doc({
  openapi: '3.1.0', 'x-relationship': { type: 'external' }, info: { title: 'Adapter', version: '1', 'x-domain': 'intake' },
  paths: { '/credentials': { post: { operationId: 'requestCredentials', security: [{ callerId: [] }] } }, '/streams': { post: { operationId: 'startStream' } } },
  components: { securitySchemes: { callerId: { $ref: `${SHARED}#/callerId` } } },
}, { relativePath: 'domains/intake/intake-adapter-openapi.yaml' });
const content = (result, path) => result.docs.find((d) => d.relativePath === path).content;

describe('requireSignIn', () => {
  test('a domain API requires each shared scheme, as alternatives, with a $ref to each', () => {
    const result = requireSignIn([schemes({ bearerAuth: { type: 'oauth2' }, cookieAuth: { type: 'apiKey', in: 'cookie', name: 'session' } }), api()]);
    const intake = content(result, 'domains/intake/intake-openapi.yaml');
    assert.deepEqual(intake.security, [{ bearerAuth: [] }, { cookieAuth: [] }]);
    assert.deepEqual(intake.components.securitySchemes, {
      bearerAuth: { $ref: '../../base/components/security-schemes.yaml#/bearerAuth' },
      cookieAuth: { $ref: '../../base/components/security-schemes.yaml#/cookieAuth' },
    });
  });

  test('an operation naming the default gets the environment\'s schemes; an adapter\'s API gets no requirement of its own', () => {
    const result = requireSignIn([schemes({ bearerAuth: { type: 'oauth2' } }), adapter()]);
    const adapted = content(result, 'domains/intake/intake-adapter-openapi.yaml');
    assert.deepEqual(adapted.paths['/credentials'].post.security, [{ bearerAuth: [] }]);
    assert.equal(adapted.paths['/streams'].post.security, undefined);
    assert.equal(adapted.security, undefined);
    assert.deepEqual(adapted.components.securitySchemes, { bearerAuth: { $ref: '../../base/components/security-schemes.yaml#/bearerAuth' } });
  });

  test('a public operation and an API\'s own scheme are left as written', () => {
    const own = api({
      paths: { '/health': { get: { operationId: 'health', security: [] } }, '/claims': { get: { operationId: 'claims', security: [{ apiKey: [] }] } } },
      components: { securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' } } },
    });
    const result = requireSignIn([schemes({ callerId: { type: 'apiKey', in: 'header', name: 'X-Caller-Id' } }), own]);
    const intake = content(result, 'domains/intake/intake-openapi.yaml');
    assert.deepEqual(intake.paths['/health'].get.security, []);
    assert.deepEqual(intake.paths['/claims'].get.security, [{ apiKey: [] }]);
    assert.deepEqual(Object.keys(intake.components.securitySchemes).sort(), ['apiKey', 'callerId']);
  });

  test('a top-level requirement the author wrote with a scheme of its own is left, for validation to report', () => {
    const written = api({ security: [{ jwt: [] }], components: { securitySchemes: { jwt: { type: 'http', scheme: 'bearer' } } } });
    const result = requireSignIn([schemes({ bearerAuth: { type: 'oauth2' } }), written]);
    assert.deepEqual(content(result, 'domains/intake/intake-openapi.yaml').security, [{ jwt: [] }]);
  });

  test('with no shared schemes left, nothing requires sign-in', () => {
    const result = requireSignIn([schemes({}), api(), adapter()]);
    assert.equal(content(result, 'domains/intake/intake-openapi.yaml').security, undefined);
    const adapted = content(result, 'domains/intake/intake-adapter-openapi.yaml');
    assert.deepEqual(adapted.paths['/credentials'].post.security, []);
    assert.equal(adapted.components?.securitySchemes, undefined);
  });

  test('a document written out, with relative references, is recognized and updated the same way', () => {
    // As the explorer applies an environment in the page to contracts resolve wrote out.
    const written = doc({
      openapi: '3.1.0', info: { title: 'Intake', version: '1', 'x-domain': 'intake' }, paths: {},
      security: [{ callerId: [] }],
      components: { securitySchemes: { callerId: { $ref: '../../base/components/security-schemes.yaml#/callerId' } } },
    }, { relativePath: 'domains/intake/intake-openapi.yaml' });
    const intake = content(requireSignIn([schemes({ bearerAuth: { type: 'oauth2' } }), written]), 'domains/intake/intake-openapi.yaml');
    assert.deepEqual(intake.security, [{ bearerAuth: [] }]);
    assert.deepEqual(intake.components.securitySchemes, { bearerAuth: { $ref: '../../base/components/security-schemes.yaml#/bearerAuth' } });
  });

  test('an AsyncAPI document is left alone', () => {
    const events = doc({
      asyncapi: '3.0.0', info: { title: 'Intake events', version: '1', 'x-domain': 'intake' },
      operations: { sendDone: { action: 'send', channel: { $ref: '#/channels/done' } } },
    }, { relativePath: 'domains/intake/intake-events-asyncapi.yaml' });
    const result = requireSignIn([schemes({ bearerAuth: { type: 'oauth2' } }), events]);
    assert.equal(result.docs[1], events);
  });

  test('a document that isn\'t an API is left alone', () => {
    const machine = doc({ domain: 'intake', machines: [] }, { relativePath: 'domains/intake/intake-state-machine.yaml' });
    const result = requireSignIn([schemes({ bearerAuth: { type: 'oauth2' } }), machine]);
    assert.equal(result.docs[1], machine);
  });
});

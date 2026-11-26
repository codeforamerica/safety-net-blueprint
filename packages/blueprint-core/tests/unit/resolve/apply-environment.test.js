/**
 * Unit tests for resolve/apply-environment.js
 *
 * The release step on built contracts, as the explorer runs it in the page:
 * the environment's overlays, its nodes, its config values, and the sign-in
 * it requires.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyEnvironment } from '../../../src/resolve/apply-environment.js';
import { doc } from '../../helpers/docs.js';

// Built: the framework's default sign-in, and the event prefix left as a placeholder.
const schemes = doc({ callerId: { type: 'apiKey', in: 'header', name: 'X-Caller-Id' } }, { relativePath: 'base/components/security-schemes.yaml', type: 'unknown' });
const api = doc({ openapi: '3.1.0', info: { title: 'Intake', version: '1', 'x-domain': 'intake' }, paths: {} }, { relativePath: 'domains/intake/intake-openapi.yaml' });
const events = doc({ asyncapi: '3.0.0', info: { title: 'Intake events', version: '1', 'x-domain': 'intake' }, channels: { submitted: { address: '${EVENT_PREFIX}intake.application.submitted' } } }, { relativePath: 'domains/intake/intake-events-asyncapi.yaml' });
const signIn = (scheme) => ({ overlay: '1.0.0', actions: [
  { target: '$', files: 'base/components/security-schemes.yaml', update: scheme },
  { target: '$.callerId', files: 'base/components/security-schemes.yaml', remove: true },
] });
const production = { overlays: [signIn({ bearerAuth: { type: 'openIdConnect', openIdConnectUrl: '${SIGN_IN_URL}' } })], envVariables: { SIGN_IN_URL: 'https://login.example.gov/.well-known/openid-configuration', EVENT_PREFIX: 'ca.' } };
const find = (result, path) => result.docs.find((d) => d.relativePath === path).content;

describe('applyEnvironment', () => {
  test('production: its overlay\'s scheme, its values, and the requirement on every API', () => {
    const result = applyEnvironment([schemes, api, events], production);
    assert.deepEqual(find(result, 'base/components/security-schemes.yaml'), { bearerAuth: { type: 'openIdConnect', openIdConnectUrl: 'https://login.example.gov/.well-known/openid-configuration' } });
    assert.deepEqual(find(result, 'domains/intake/intake-openapi.yaml').security, [{ bearerAuth: [] }]);
    assert.equal(find(result, 'domains/intake/intake-events-asyncapi.yaml').channels.submitted.address, 'ca.intake.application.submitted');
    assert.deepEqual(result.unresolved, []);
  });

  test('another environment, another sign-in: every API follows', () => {
    const staging = { overlays: [signIn({ cookieAuth: { type: 'apiKey', in: 'cookie', name: 'session' } })], envVariables: { EVENT_PREFIX: '' } };
    assert.deepEqual(find(applyEnvironment([schemes, api], staging), 'domains/intake/intake-openapi.yaml').security, [{ cookieAuth: [] }]);
  });

  test('no overlay: the framework\'s default sign-in', () => {
    assert.deepEqual(find(applyEnvironment([schemes, api], { envVariables: {} }), 'domains/intake/intake-openapi.yaml').security, [{ callerId: [] }]);
  });

  test('reports a placeholder no value was given for', () => {
    assert.deepEqual(applyEnvironment([schemes, api, events], { overlays: production.overlays, envVariables: {} }).unresolved, ['EVENT_PREFIX', 'SIGN_IN_URL']);
  });
});

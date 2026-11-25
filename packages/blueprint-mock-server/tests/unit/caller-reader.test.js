/**
 * Who's calling, read the way the contracts' schemes say (auth-context.js):
 * a header for a scheme in a header, a token's claims for a bearer, OAuth or
 * OpenID Connect one, nobody from a cookie, and X-Caller-Id when no scheme
 * identifies the request. And a published event says who published it from
 * that, not from what its envelope claims.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { callerReader, identify, callerOf } from '../../src/auth-context.js';
import { readFileSync } from 'node:fs';
import { createMockServer } from '../../src/server.js';

const token = (claims) => `${btoa(JSON.stringify({ alg: 'none' }))}.${btoa(JSON.stringify(claims)).replace(/=+$/, '')}.`;
const request = (headers) => new Request('http://localhost/x', { headers });

describe('callerReader', () => {
  test('a scheme in a header: its value is the id, and x-caller names the roles header', () => {
    const read = callerReader({ callerId: { type: 'apiKey', in: 'header', name: 'X-Caller-Id', 'x-caller': { roles: 'X-Caller-Roles' } } });
    assert.deepEqual(read(request({ 'X-Caller-Id': 'worker-1', 'X-Caller-Roles': 'caseworker, supervisor' })), { id: 'worker-1', roles: ['caseworker', 'supervisor'] });
    assert.equal(read(request({})), null);
  });

  test('a token: the claims x-caller names, a state\'s own included', () => {
    const read = callerReader({ bearerAuth: { type: 'http', scheme: 'bearer', 'x-caller': { id: 'userId', roles: 'roles', counties: 'counties' } } });
    const caller = read(request({ Authorization: `Bearer ${token({ sub: 'idp|1', userId: 'u-1', roles: ['caseworker'], counties: ['06001'] })}` }));
    assert.deepEqual(caller, { id: 'u-1', roles: ['caseworker'], counties: ['06001'] });
  });

  test('OpenID Connect with no x-caller reads sub and roles', () => {
    const read = callerReader({ oidc: { type: 'openIdConnect', openIdConnectUrl: 'https://idp/.well-known/openid-configuration' } });
    assert.deepEqual(read(request({ Authorization: `Bearer ${token({ sub: 'pat', roles: 'staff' })}` })), { id: 'pat', roles: ['staff'] });
  });

  test('a cookie identifies no one: it\'s the server\'s own session', () => {
    const read = callerReader({ cookieAuth: { type: 'apiKey', in: 'cookie', name: 'session' } });
    assert.equal(read(request({ Cookie: 'session=abc' })), null);
  });

  test('what everything else reads is the identified caller, or X-Caller-Id when none was', () => {
    const read = callerReader({ bearerAuth: { type: 'oauth2', 'x-caller': { id: 'sub', roles: 'roles', counties: 'counties' } } });
    const signedIn = request({ Authorization: `Bearer ${token({ sub: 'pat', roles: ['caseworker'], counties: ['06001'] })}` });
    identify(signedIn, read(signedIn));
    assert.deepEqual(callerOf(signedIn), { id: 'pat', roles: ['caseworker'], counties: ['06001'] });
    const named = request({ 'X-Caller-Id': 'worker-1', 'X-Caller-Roles': 'caseworker' });
    identify(named, read(named));
    assert.deepEqual(callerOf(named), { id: 'worker-1', roles: ['caseworker'] });
  });
});

describe('a published event says who published it', () => {
  const publish = async (mock, headers, envelope) => (await mock.fetch(new Request('http://localhost/platform/events', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(envelope),
  }))).json();

  test('from the caller, whatever the envelope claims; unauthenticated when nobody is identified', async () => {
    const harness = JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/contracts.json', import.meta.url), 'utf8'));
    const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
    let mock;
    try { mock = await createMockServer({ contracts: harness }); } finally { console.log = log; console.warn = warn; }
    const envelope = { specversion: '1.0', id: 'e1', source: '/test', type: 'test.thing.happened', authid: 'someone-else', authtype: 'system' };
    // The harness's local environment identifies callers by X-Caller-Id.
    const signedIn = await publish(mock, { 'X-Caller-Id': 'pat', 'X-Caller-Roles': 'caseworker' }, envelope);
    assert.equal(signedIn.authid, 'pat');
    assert.equal(signedIn.authtype, 'user');
    const nobody = await publish(mock, {}, { ...envelope, id: 'e2' });
    assert.equal(nobody.authid, undefined);
    assert.equal(nobody.authtype, 'unauthenticated');
  });
});

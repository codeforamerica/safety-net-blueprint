import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { domainsFromContracts } from '../../../src/context-map/resolve-config.js';

/** A loaded OpenAPI document, as `discover().map(load)` hands one over. */
function openapi(domain, { paths = {}, schemas = {} } = {}) {
  return {
    type: 'openapi',
    domain,
    content: { info: { 'x-domain': domain }, paths, schemas: undefined, components: { schemas } },
  };
}

describe('domainsFromContracts', () => {
  it('takes the domains from the contracts, not from the overrides', () => {
    const docs = [openapi('intake'), openapi('eligibility')];
    const domains = domainsFromContracts(docs, []);

    assert.deepEqual(domains.map(d => d.id), ['eligibility', 'intake']);
  });

  it('includes a domain nobody wrote an override for', () => {
    // The failure this guards: `platform` and `identity-access` existed in the
    // contract set for weeks and never appeared, because the list was authored.
    const docs = [openapi('intake'), openapi('platform')];
    const domains = domainsFromContracts(docs, [{ id: 'intake', label: 'Intake', status: 'partial' }]);

    assert.ok(domains.some(d => d.id === 'platform'));
  });

  it('refuses an override naming a domain the contracts do not declare', () => {
    // The other half: `appeals_hearings` was drawn on the published context
    // map long after the domain was deleted.
    const docs = [openapi('intake')];

    assert.throws(
      () => domainsFromContracts(docs, [{ id: 'appeals_hearings', label: 'Appeals', status: 'not-started' }]),
      /appeals_hearings/,
    );
  });

  it('hyphenates into the snake_case ids the diagram uses', () => {
    const domains = domainsFromContracts([openapi('case-management')], []);

    assert.equal(domains[0].id, 'case_management');
    assert.equal(domains[0].label, 'Case Management');
  });

  it('lets an override win over what was derived', () => {
    const docs = [openapi('intake', { paths: { '/applications': {} } })];
    const domains = domainsFromContracts(docs, [
      { id: 'intake', label: 'Intake & Screening', status: 'design-complete' },
    ]);

    assert.equal(domains[0].label, 'Intake & Screening');
    assert.equal(domains[0].status, 'design-complete');
  });

  it('calls a domain with no operations not-started, and one with them partial', () => {
    const docs = [
      openapi('communication'),
      openapi('intake', { paths: { '/applications': {} } }),
    ];
    const byId = Object.fromEntries(domainsFromContracts(docs, []).map(d => [d.id, d]));

    assert.equal(byId.communication.status, 'not-started');
    assert.equal(byId.intake.status, 'partial');
  });

  it('counts resources as entities and leaves the shapes derived from them out', () => {
    const docs = [openapi('intake', {
      schemas: {
        Application: {}, ApplicationCreate: {}, ApplicationUpdate: {},
        ApplicationList: {}, ApplicationIdParam: {}, ApplicationMember: {},
      },
    })];

    assert.deepEqual(domainsFromContracts(docs, [])[0].entities, ['Application', 'ApplicationMember']);
  });

  it('merges the domain across every document that declares it', () => {
    const docs = [
      openapi('platform', { paths: { '/events': {} }, schemas: { Event: {} } }),
      openapi('platform', { paths: { '/search': {} }, schemas: { SearchResult: {} } }),
    ];
    const [platform] = domainsFromContracts(docs, []);

    assert.deepEqual(platform.entities, ['Event', 'SearchResult']);
    assert.equal(platform.status, 'partial');
  });

  it('ignores documents that are not APIs', () => {
    const docs = [openapi('intake'), { type: 'asyncapi', domain: 'scheduling', content: {} }];

    assert.deepEqual(domainsFromContracts(docs, []).map(d => d.id), ['intake']);
  });
});

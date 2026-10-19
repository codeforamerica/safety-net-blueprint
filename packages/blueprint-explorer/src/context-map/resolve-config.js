/**
 * resolve-config.js
 *
 * Loads the explorer's config.yaml and replaces its domains with the ones the
 * contracts define.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { discover, load } from '@codeforamerica/blueprint-core';

/**
 * The explorer's config, with the domains the contracts define.
 *
 * @param {string} contractsDir path to the resolved contracts.
 * @param {string} contentDir path to the content package root.
 * @returns {Object} config.yaml, with `domains` from the contracts
 */
export function resolveConfig(contractsDir, contentDir) {
  const config = yaml.load(readFileSync(join(contentDir, 'config.yaml'), 'utf8'));
  return {
    ...config,
    domains: domainsFromContracts(existsSync(contractsDir) ? discover(contractsDir).map(load) : [], config.domains || []),
  };
}

/**
 * The domains of a contract set, as the contracts have them.
 *
 * Which bounded contexts exist is a fact about the contracts, not an
 * editorial choice, and it was previously a hand-maintained list. It drifted:
 * the published site drew two domains that had been deleted and omitted three
 * that existed, for five weeks, because nothing compared the list to the
 * documents it claimed to describe.
 *
 * What the contracts cannot say is how far along a domain's design is, so
 * `status` and a curated `description` stay authored — supplied per id, the
 * same way the context map supplies layout positions. An override naming a
 * domain that does not exist is an error: that is exactly the drift above,
 * and silently drawing a box for it is how it survived.
 *
 * @param {Array} docs loaded contract documents
 * @param {Array} overrides `domains:` entries from config.yaml, keyed by id
 */
export function domainsFromContracts(docs, overrides) {
  const found = new Map();

  for (const doc of docs) {
    if (doc.type !== 'openapi') continue;
    const name = doc.content?.info?.['x-domain'] ?? doc.domain;
    if (!name) continue;

    const id = String(name).replace(/-/g, '_');
    const entry = found.get(id) ?? { id, label: titleCase(id), entities: new Set(), operations: 0 };
    entry.operations += Object.keys(doc.content?.paths ?? {}).length;
    for (const schema of Object.keys(doc.content?.components?.schemas ?? {})) {
      if (!isResourceSchema(schema)) continue;
      entry.entities.add(schema);
    }
    found.set(id, entry);
  }

  const byId = new Map(overrides.map(o => [o.id, o]));
  for (const id of byId.keys()) {
    if (found.has(id)) continue;
    throw new Error(
      `config.yaml names a domain "${id}" that the contract set does not declare. `
      + `Domains present: ${[...found.keys()].sort().join(', ')}.`
    );
  }

  return [...found.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(({ id, label, entities, operations }) => ({
      id,
      label,
      // A domain declaring no operations has nothing designed yet, which is
      // what `not-started` means here. Anything an author has judged
      // differently wins.
      status: operations > 0 ? 'partial' : 'not-started',
      entities: [...entities].sort(),
      ...(byId.get(id) ?? {}),
    }));
}

/** `client_management` → `Client Management`. */
function titleCase(id) {
  return id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Whether a schema name is a resource rather than a shape derived from one.
 *
 * `Application` is an entity of the intake domain; `ApplicationCreate`,
 * `ApplicationList` and `ApplicationIdParam` are the write, page and
 * parameter shapes built from it, and listing them as entities says the
 * domain holds four things where it holds one.
 */
const DERIVED_SUFFIX = /(Create|Update|Writable|List|ListResponse|Response|Request|Param|Example\d*)$/;
function isResourceSchema(name) {
  return !DERIVED_SUFFIX.test(name);
}

// ── Internal helpers ───────────────────────────────────────────────────────────




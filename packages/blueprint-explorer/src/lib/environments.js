/**
 * A site's environments, at build time (config.yaml's `environments`).
 *
 * Each names its config, a file of NAME=value lines as blueprint-resolve's
 * --env-variables reads; its overlays, as --env-overlay reads; its routing;
 * and its sign-in. The build reads them here, writes the first one's release
 * for the reference pages (releaseTo), and puts every one on the page for the
 * explorer to apply when the reader picks it (site-routing.js, then
 * try-it/environments.js).
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import yaml from 'js-yaml';
import { applyEnvironment } from '@codeforamerica/blueprint-core/browser';
import { discover, load } from '@codeforamerica/blueprint-core';
import { loadConfig } from './config.js';

/**
 * A file of NAME=value lines, as blueprint-resolve reads one: blank lines and
 * `#` comments skipped, surrounding quotes stripped.
 *
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnvFile(text) {
  const values = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('=');
    if (at === -1) continue;
    let value = trimmed.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[trimmed.slice(0, at).trim()] = value;
  }
  return values;
}

/**
 * The environments config.yaml lists, each with its files read, or none.
 *
 * @param {string} configDir
 * @returns {Array<{ name: string, variables: Record<string,string>, overlays: object[], routing: string|null, sign_in: object|null }>}
 * @throws {Error} When a file it names isn't there
 */
export function readEnvironments(configDir) {
  const { environments = [] } = loadConfig(configDir);
  const read = (named, what) => {
    const file = join(configDir, named);
    if (!existsSync(file)) throw new Error(`config.yaml's environment ${what} names ${named}, but ${file} doesn't exist.`);
    return readFileSync(file, 'utf8');
  };
  // As blueprint-resolve reads one: the file says which variables there are,
  // and the environment the build runs in may override their values.
  const valuesOf = (text) => Object.fromEntries(Object.entries(parseEnvFile(text)).map(([name, value]) => [name, process.env[name] ?? value]));
  return environments.map((environment) => ({
    name: environment.name,
    variables: environment.variables ? valuesOf(read(environment.variables, `${environment.name}'s variables`)) : {},
    overlays: (environment.overlays ?? []).map((named) => yaml.load(read(named, `${environment.name}'s overlays`))),
    routing: environment.routing ?? null,
    sign_in: environment.sign_in ?? null,
  }));
}

/**
 * Write an environment's release of built contracts to a folder, as
 * blueprint-resolve would with its --env-variables and --env-overlay, for the
 * page builders that read contracts from one.
 *
 * @param {string} builtDir - The contracts resolved without an environment
 * @param {{ name: string, variables: Record<string,string>, overlays: object[] }} environment
 * @param {string} outDir
 * @returns {string[]} The `${VAR}`s it gave no value for
 */
export function releaseTo(builtDir, environment, outDir) {
  const { docs, unresolved } = applyEnvironment(discover(builtDir).map(load), {
    overlays: environment.overlays, envTarget: environment.name, envVariables: environment.variables,
  });
  rmSync(outDir, { recursive: true, force: true });
  for (const doc of docs) {
    const file = join(outDir, doc.relativePath);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, yaml.dump(doc.content, { lineWidth: -1, noRefs: true }));
  }
  return unresolved;
}

/**
 * For a site that lists environments, write the first one's release of the
 * contracts it's built from, for the reference pages to show: the CLI's
 * blueprint-build-explorer builds them from it, and the page applies the
 * environment the reader picks to the contracts as built.
 *
 * @param {string} builtDir - The contracts resolved without an environment
 * @param {string} configDir - Where config.yaml is
 * @param {string} outDir - Where to write the release
 * @returns {{ name: string, unresolved: string[] } | null} The environment
 *   written, and the `${VAR}`s it gave no value for; null when config.yaml
 *   lists none, and nothing is written
 */
export function releaseEnvironment(builtDir, configDir, outDir) {
  const [first] = readEnvironments(configDir);
  if (!first) return null;
  return { name: first.name, unresolved: releaseTo(builtDir, first, outDir) };
}

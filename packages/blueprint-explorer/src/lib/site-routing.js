/**
 * A site's routing, on every page of a built explorer: `routing` in
 * config.yaml names a routing file (blueprint-core's schemas/routing-schema.yaml),
 * relative to config.yaml, saying which operations something other than the
 * mock in the page answers — a service at a URL, or a module of handlers, such
 * as a transcription session adapter for one provider.
 *
 * A page opened from disk can't import a module, so the build bundles the
 * file and the handler modules it names, with whatever they import, into one
 * script, site-routing.js, that adds its routes to BlueprintExplorer.routing,
 * after the site's own script's. The routing is checked against the contracts first
 * (core's validateRouting), so a mistake fails the build, not a visitor's page.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve, sep } from 'path';
import yaml from 'js-yaml';
import { discover, load, validateRouting } from '@codeforamerica/blueprint-core';
import { applyEnvironment } from '@codeforamerica/blueprint-core/browser';
import { loadConfig } from './config.js';
import { readEnvironments } from './environments.js';

/** The bundled routing, in the built site. */
export const SITE_ROUTING = 'site-routing.js';
const MARK = '<!-- the site\'s routing -->';

/**
 * A routing file, checked against contracts, as code: its entries, each module
 * it names imported once (as `module<n>`, numbered from `first`), in place of
 * its path.
 *
 * @returns {{ imports: string[], routes: string, modules: number }}
 * @throws {Error} Naming every problem
 */
function routingCode(file, named, docs, first) {
  if (!existsSync(file)) throw new Error(`config.yaml names routing: ${named}, but ${file} doesn't exist.`);
  const text = readFileSync(file, 'utf8');
  const document = file.endsWith('.json') ? JSON.parse(text) : yaml.load(text);

  const { errors, warnings } = validateRouting(document, docs);
  const entries = Array.isArray(document?.routing) ? document.routing : [];
  for (const entry of entries) {
    if (typeof entry?.handler === 'string' && !existsSync(resolve(dirname(file), entry.handler))) {
      errors.push(`${named} names handler ${entry.handler}, which doesn't exist beside it`);
    }
  }
  for (const warning of warnings) console.warn(`  Warning (${named}): ${warning}`);
  if (errors.length) throw new Error(`${named} is not valid:\n${errors.map((e) => `  ${e}`).join('\n')}`);

  // One import per module, and the entries as written, each module in place of its path.
  const modules = entries.map((entry) => (typeof entry.handler === 'string' ? resolve(dirname(file), entry.handler) : null));
  let n = first;
  const names = modules.map((path) => (path ? `module${n++}` : null));
  const imports = modules.map((path, i) => (path ? `import * as ${names[i]} from ${JSON.stringify(path)};` : '')).filter(Boolean);
  const routes = entries.map((entry, i) => {
    const { handler, ...rest } = entry;
    // The file as written, for the control panel to name (try-it/routing.js, HANDLER_FILE).
    return modules[i]
      ? `{ ...${JSON.stringify(rest)}, handler: ${names[i]}, [Symbol.for('blueprint-explorer.handler-file')]: ${JSON.stringify(handler)} }`
      : JSON.stringify(entry);
  }).join(',\n  ');
  return { imports, routes: `[${routes}]`, modules: n - first };
}

/**
 * Check the routing config.yaml names and bundle it, with its modules, into
 * the built site. For a site that lists environments, each one's: its
 * routing, checked against its release of the contracts, with its config,
 * overlays and sign-in, as BlueprintExplorer.environments for the page to
 * apply the one picked (try-it/environments.js). Nothing to do when
 * config.yaml names no routing and lists no environments.
 *
 * @param {{ configDir: string, outDir: string, resolvedDir: string }} options -
 *   resolvedDir is the contracts the site is built from: resolved without an
 *   environment, when it lists environments
 * @throws {Error} Naming every problem, when a file or a module is missing or the routing is wrong
 */
export async function bundleSiteRouting({ configDir, outDir, resolvedDir }) {
  const config = loadConfig(configDir);
  const environments = readEnvironments(configDir);
  if (!config.routing && !environments.length) return;
  const docs = discover(resolvedDir).map(load);

  let entry;
  let named = config.routing;
  if (environments.length) {
    const imports = [];
    const listed = environments.map((environment) => {
      const { routing, ...rest } = environment;
      let routes = '[]';
      if (routing) {
        const released = applyEnvironment(docs, { overlays: environment.overlays, envTarget: environment.name, envVariables: environment.variables }).docs;
        const code = routingCode(join(configDir, routing), routing, released, imports.length);
        imports.push(...code.imports);
        routes = code.routes;
      }
      return `{ ...${JSON.stringify(rest)}, routing: ${routes} }`;
    });
    named = 'config.yaml\'s environments';
    entry = `${imports.join('\n')}
globalThis.BlueprintExplorer ??= {};
globalThis.BlueprintExplorer.environments = [
  ${listed.join(',\n  ')}];
`;
  } else {
    const code = routingCode(join(configDir, named), named, docs, 0);
    entry = `${code.imports.join('\n')}
globalThis.BlueprintExplorer ??= {};
globalThis.BlueprintExplorer.routing = [...(globalThis.BlueprintExplorer.routing ?? []),
  ...${code.routes}];
`;
  }
  const { build } = await import('esbuild');
  await build({
    stdin: { contents: entry, resolveDir: configDir, sourcefile: 'site-routing-entry.js' },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    outfile: join(outDir, SITE_ROUTING),
    logLevel: 'error',
    banner: { js: `// ${named}, and the modules it names, bundled by the explorer's build.` },
  });
}

/** Every HTML page under a folder. */
const pagesUnder = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  if (entry.isDirectory()) return pagesUnder(path);
  return entry.name.endsWith('.html') ? [path] : [];
});

/**
 * Load the bundled routing on every page of a built explorer, where it isn't
 * yet, at the end of the page, after the site's own script: before the
 * deferred scripts that start the mock. Nothing to do when there's none.
 *
 * @param {string} contentDir - The built explorer
 */
export function addSiteRouting(contentDir) {
  if (!existsSync(join(contentDir, SITE_ROUTING))) return;
  for (const page of pagesUnder(contentDir)) {
    const html = readFileSync(page, 'utf8');
    if (html.includes(MARK) || !html.includes('</body>')) continue;
    const root = '../'.repeat(relative(contentDir, page).split(sep).length - 1);
    const at = html.lastIndexOf('</body>');
    writeFileSync(page, `${html.slice(0, at)}${MARK}\n<script src="${root}${SITE_ROUTING}"></script>\n${html.slice(at)}`);
  }
}

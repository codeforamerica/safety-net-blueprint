/**
 * A site's own script, on every page of a built explorer.
 *
 * The explorer's pages are generated, so a site can't edit them, and
 * config.yaml is data, so it can't hold a function. `script` in config.yaml
 * names a JavaScript file, relative to config.yaml, that every page loads,
 * the authored ones too: where a developer portal puts what only code can do,
 * such as a routing handler that adds the visitor's sign-in token
 * (BlueprintExplorer.routing, read by try-it/start-mock.js).
 *
 * The tag goes in at the end of the page, as an ordinary script, so it runs
 * while the page loads: before the deferred scripts that start the mock.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, relative, sep } from 'path';
import { loadConfig } from './config.js';

const MARK = '<!-- the site\'s own script -->';

/** Every HTML page under a folder. */
const pagesUnder = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  if (entry.isDirectory()) return pagesUnder(path);
  return entry.name.endsWith('.html') ? [path] : [];
});

/**
 * Load the script config.yaml names on every page of a built explorer, where
 * it isn't yet. Nothing to do when config.yaml names none.
 *
 * @param {string} contentDir - The built explorer, where config.yaml is
 * @throws {Error} When config.yaml names a script that isn't there
 */
export function addSiteScript(contentDir) {
  const { script } = loadConfig(contentDir);
  if (!script) return;
  if (!existsSync(join(contentDir, script))) {
    throw new Error(`config.yaml names script: ${script}, but ${join(contentDir, script)} doesn't exist.`);
  }
  for (const page of pagesUnder(contentDir)) {
    const html = readFileSync(page, 'utf8');
    if (html.includes(MARK) || !html.includes('</body>')) continue;
    const root = '../'.repeat(relative(contentDir, page).split(sep).length - 1);
    // Where the script registers what it sets, so it needn't make the object.
    const added = `${MARK}
<script>globalThis.BlueprintExplorer ??= {};</script>
<script src="${root}${script}"></script>`;
    const at = html.lastIndexOf('</body>');
    writeFileSync(page, `${html.slice(0, at)}${added}\n${html.slice(at)}`);
  }
}

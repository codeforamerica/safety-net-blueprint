/**
 * The control panel's button, on the pages of a built explorer.
 *
 * Added once every page is built, to each one, rather than to each page
 * template: the explorer's pages come from several of them. Pressing the
 * button loads the mock, if the page hasn't, and opens the drawer
 * (try-it/control-panel.js).
 *
 * The authored pages, written for state leadership rather than developers,
 * have no button. Every page, those too, starts the mock's records over when
 * it is reloaded, as a page running the mock does (try-it/records.js): a
 * reload anywhere starts again from the sample records.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, relative, sep } from 'path';

const MARK = '<!-- the mock: control panel -->';

/**
 * Forgetting what pages left for the next, on a reload: the keys records.js
 * keeps the mock's records, stubs and each page's results under.
 */
const resetOnReload = (root) => `
<script>
(() => {
  let reloaded = false;
  try { reloaded = performance.getEntriesByType('navigation')[0]?.type === 'reload'; } catch { /* not known */ }
  if (!reloaded) return;
  const scope = new URL('${root}mock/', location.href).href;
  try {
    for (const key of Object.keys(sessionStorage)) {
      if ([\`blueprint-mock-records:\${scope}\`, \`blueprint-mock-stubs:\${scope}\`].includes(key)
        || key.startsWith(\`blueprint-try-results:\${scope}:\`)) sessionStorage.removeItem(key);
    }
  } catch { /* nothing saved */ }
})();
</script>`;

/**
 * The button and what it runs, for a page `root` away from the explorer's
 * top: '' for index.html, '../' for a page in a folder.
 */
const launcher = (root) => `
<button id="mock-panel-toggle" type="button" aria-controls="mock-panel" aria-expanded="false"
  style="position:fixed;right:16px;bottom:16px;z-index:999;font:600 13px system-ui,sans-serif;padding:8px 14px;border-radius:100px;border:0;background:#2B1A78;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer;">Mock server</button>
<script>
(() => {
  const root = new URL('${root}', location.href);
  const load = (src) => new Promise((resolve, reject) => document.head.append(
    Object.assign(document.createElement('script'), { src, onload: resolve, onerror: reject })));
  // A page that runs the mock has it loading already; any other loads it now.
  const ready = () => {
    if (globalThis.BlueprintMock && globalThis.BlueprintContracts) return Promise.resolve();
    if (document.querySelector('script[src$="mock/mock.js"]')) {
      return new Promise((resolve) => (document.readyState === 'complete' ? resolve() : addEventListener('load', resolve)));
    }
    return load(new URL('mock/mock.js', root).href).then(() => load(new URL('mock/contracts.js', root).href));
  };
  document.getElementById('mock-panel-toggle').onclick = () => ready().then(() => BlueprintMock.toggleControlPanel({
    contracts: BlueprintContracts, version: BlueprintContractsVersion, scope: new URL('mock/', root).href,
  }));
})();
</script>`;

/** Every HTML page under a folder. */
const pagesUnder = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  if (entry.isDirectory()) return pagesUnder(path);
  return entry.name.endsWith('.html') ? [path] : [];
});

/**
 * Put the control panel's button on the pages of a built explorer, and
 * starting over on a reload on every page, where they haven't them yet.
 * Nothing to do when the explorer was built without the mock.
 *
 * @param {string} contentDir - The built explorer
 */
export function addControlPanel(contentDir) {
  if (!existsSync(join(contentDir, 'mock', 'mock.js'))) return;
  for (const page of pagesUnder(contentDir)) {
    const html = readFileSync(page, 'utf8');
    if (html.includes(MARK) || html.includes('id="mock-panel-toggle"') || !html.includes('</body>')) continue;
    const parts = relative(contentDir, page).split(sep);
    const root = '../'.repeat(parts.length - 1);
    const added = MARK + resetOnReload(root) + (parts[0] === 'authored' ? '' : launcher(root));
    const at = html.lastIndexOf('</body>');
    writeFileSync(page, `${html.slice(0, at)}${added}\n${html.slice(at)}`);
  }
}

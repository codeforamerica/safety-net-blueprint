/**
 * The Try it switch, on the pages of a built explorer.
 *
 * Added once every page is built, to each one, rather than to each page
 * template: the explorer's pages come from several of them. Turning it on
 * loads the mock, if the page hasn't, and docks the control panel beside the
 * page (try-it/control-panel.js).
 *
 * Only API reference pages with operations get the switch: they're where you
 * send something. The Scenarios page runs a mock of its own. Every page
 * starts the mock's records over when it's reloaded, as a page running the
 * mock does (try-it/records.js): a reload anywhere starts again from the
 * sample records.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, relative, sep } from 'path';
import { loadConfig } from './config.js';

const MARK = '<!-- the mock: control panel -->';

/**
 * Forgetting what pages left for the next, on a reload: the keys records.js
 * keeps the mock's records, stubs and each page's results under, and
 * routing.js the server chosen in the page,
 * sign-in.js who is signed in,
 * and activity.js the requests Try it sent, for every environment
 * (try-it/environments.js). Switching environments reloads the page too, so it
 * says so first, and nothing is forgotten then.
 */
const resetOnReload = (root) => `
<script>
(() => {
  let reloaded = false;
  try { reloaded = performance.getEntriesByType('navigation')[0]?.type === 'reload'; } catch { /* not known */ }
  const scope = new URL('${root}mock/', location.href).href;
  try {
    if (sessionStorage.getItem('blueprint-mock-switching:' + scope)) {
      sessionStorage.removeItem('blueprint-mock-switching:' + scope);
      // A switch, not a reload: the records go on (try-it/records.js reads this).
      document.documentElement.dataset.environmentSwitched = '';
      return;
    }
  } catch { /* not switching */ }
  if (!reloaded) return;
  // Each environment's keys have its name after the scope (scope#name).
  const ours = (key, kind) => key === \`\${kind}:\${scope}\` || key.startsWith(\`\${kind}:\${scope}#\`);
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (['blueprint-mock-records', 'blueprint-mock-stubs', 'blueprint-mock-server', 'blueprint-mock-sign-in', 'blueprint-mock-activity'].some((kind) => ours(key, kind))
        || key.startsWith(\`blueprint-try-results:\${scope}\`)) sessionStorage.removeItem(key);
    }
  } catch { /* nothing saved */ }
})();
</script>`;

/**
 * The Try it switch and what it runs, for a page `root` away from the
 * explorer's top: '' for index.html, '../' for a page in a folder.
 *
 * Like a browser's developer tools: off, the page is the reference alone;
 * on, the control panel docks beside it (try-it/control-panel.js), and the
 * page narrows to make room. The choice is stored in sessionStorage, so it
 * holds for every page in the browser tab.
 */
const launcher = (root) => `
<style>
  #try-it-switch { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; font: 600 12px system-ui, sans-serif;
    color: #fff; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.3); border-radius: 100px; padding: 2px 4px 2px 10px; cursor: pointer; }
  #try-it-switch .knob { width: 28px; height: 16px; border-radius: 8px; background: rgba(255,255,255,.3); position: relative; transition: background .15s; }
  #try-it-switch .knob::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; transition: left .15s; }
  #try-it-switch[aria-checked="true"] .knob { background: #22c55e; }
  #try-it-switch[aria-checked="true"] .knob::after { left: 14px; }
  #try-it-switch.floating { position: fixed; top: 8px; right: 16px; z-index: 1001; background: #2B1A78; }
  html[data-try-it="on"] body { padding-right: var(--mock-panel-width, 30rem); }
  /* Narrow, the panel docks along the bottom instead, as developer tools do. */
  @media (max-width: 1200px) { html[data-try-it="on"] body { padding-right: 0; padding-bottom: var(--mock-panel-height, 40vh); } }
</style>
<script>
(() => {
  const root = new URL('${root}', location.href);
  const scope = new URL('mock/', root).href;
  const key = 'blueprint-try-it:' + scope;
  const stored = () => { try { return sessionStorage.getItem(key) === 'on'; } catch { return false; } };
  const remember = (on) => { try { if (on) sessionStorage.setItem(key, 'on'); else sessionStorage.removeItem(key); } catch { /* this page only */ } };
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

  const toggle = document.createElement('button');
  toggle.id = 'try-it-switch';
  toggle.type = 'button';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-controls', 'mock-panel');
  toggle.append('Try it', Object.assign(document.createElement('span'), { className: 'knob' }));
  const crumbs = document.querySelector('.page-crumbs');
  if (crumbs) crumbs.append(toggle); else { toggle.classList.add('floating'); document.body.append(toggle); }

  const show = (on) => {
    document.documentElement.dataset.tryIt = on ? 'on' : 'off';
    toggle.setAttribute('aria-checked', String(on));
    toggle.title = on ? 'Turn off Try it and show the reference only' : 'Turn on Try it to send requests to the mock running in this page';
  };
  const turn = (on) => {
    remember(on);
    show(on);
    // In the environment the reader picked (try-it/environments.js).
    return ready().then(() => BlueprintMock.setTryIt(on,
      BlueprintMock.inEnvironment({ contracts: BlueprintContracts, version: BlueprintContractsVersion, scope })));
  };
  toggle.onclick = () => turn(toggle.getAttribute('aria-checked') !== 'true');
  // The panel's own Close turns it off too.
  addEventListener('try-it', (event) => { remember(event.detail.on); show(event.detail.on); });
  show(stored());
  // Wait until every script on the page has run: site-routing.js, which lists
  // the environments, comes after this one, so the panel would otherwise read
  // and write the records of no environment.
  if (stored()) {
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', () => turn(true), { once: true });
    else turn(true);
  }
})();
</script>`;

/** Every HTML page under a folder. */
const pagesUnder = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  if (entry.isDirectory()) return pagesUnder(path);
  return entry.name.endsWith('.html') ? [path] : [];
});

/** A page that asks to be left as it is, such as a stand-in sign-in page a site adds. */
const OPT_OUT = /<meta\s+name="blueprint-try-it"\s+content="off"/;

/** A page with something to send: an operation (api-reference.js). */
const INTERACTIVE = /id="op-/;

/** The page the sign-in popup returns to: it hands what it was given to the page that opened it. */
export const SIGN_IN_RETURN = 'sign-in-return.html';
const signInReturn = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="blueprint-try-it" content="off"><title>Signing in</title></head>
<body><p>Signing in…</p>
<script>
// The provider sent the visitor here, with a token or a code after # or ?.
// The page that opened this window finishes signing in (try-it/sign-in.js).
if (window.opener) window.opener.postMessage({ blueprintSignIn: { hash: location.hash.slice(1), search: location.search.slice(1) } }, '*');
window.close();
</script>
</body></html>
`;

/**
 * Put the Try it switch on the pages of a built explorer, and
 * starting over on a reload on every page, where they haven't them yet.
 * With sign_in in config.yaml, each page also carries it, for signing in
 * where a call needs it, and the site gets the page the sign-in popup
 * returns to. Nothing to do when the explorer was built without the mock.
 *
 * @param {string} contentDir - The built explorer
 */
export function addControlPanel(contentDir) {
  if (!existsSync(join(contentDir, 'mock', 'mock.js'))) return;
  const { sign_in: signIn, environments = [] } = loadConfig(contentDir);

  // As data on the page, not code: the Try it scripts read it (try-it/sign-in.js).
  const signInData = signIn ? `\n<script type="application/json" id="blueprint-sign-in">${JSON.stringify(signIn).replace(/</g, '\\u003c')}</script>` : '';
  for (const page of pagesUnder(contentDir)) {
    const html = readFileSync(page, 'utf8');
    if (html.includes(MARK) || !html.includes('</body>') || OPT_OUT.test(html)) continue;
    const parts = relative(contentDir, page).split(sep);
    const root = '../'.repeat(parts.length - 1);
    const added = MARK + signInData + resetOnReload(root) + (INTERACTIVE.test(html) ? launcher(root) : '');
    const at = html.lastIndexOf('</body>');
    writeFileSync(page, `${html.slice(0, at)}${added}\n${html.slice(at)}`);
  }
  if (signIn || environments.some((environment) => environment.sign_in)) writeFileSync(join(contentDir, SIGN_IN_RETURN), signInReturn);
}

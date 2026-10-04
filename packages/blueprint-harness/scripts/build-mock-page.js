/**
 * Build the harness's demo page: the mock server running with no server.
 *
 * A harness script rather than a CLI bin, and deliberately not publishable.
 * Building a demo page is not a capability anyone deploying this needs — what
 * they need is what the page imports, `@codeforamerica/blueprint-mock-server/browser`
 * and `blueprint-bundle-contracts`. This assembles one worked example of the
 * two, which is what the harness is for, and its output lands in
 * `generated/mock/` beside the explorer, the schemas and the clients.
 *
 * It lived in `blueprint-cli` first, where it could not have worked: that
 * package declares no dependency on the mock server at all, and only a
 * devDependency on this one, yet the script read files from both by relative
 * path. Installed from npm, neither directory exists.
 *
 * Two outputs from one source, because two ways of serving it have different
 * constraints (#448):
 *
 *   index.html + mock.js + contracts.json
 *     Three static files, served over http(s) by anything that hands files
 *     over unchanged — GitHub Pages, S3, a local `npx serve`.
 *
 *   standalone.html
 *     One file, for `file://`, where fetching a sibling file is blocked as
 *     cross-origin. Both the bundle and the artifact are inlined.
 *
 * What the page can demonstrate depends on what the contract set declares. It
 * reads the route table the mock builds and disables what is not there, so
 * pointing it at a set with no events endpoint gives a page that says so
 * rather than one that 404s when clicked.
 *
 * Usage:
 *   node scripts/build-mock-page.js --spec=<dir> --out=<dir> [--domain=<name>]
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, statSync, existsSync } from 'node:fs';
import yaml from 'js-yaml';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The authored pages, which are this package's own input.
 *
 * A list rather than a constant because pages share one `mock.js` and one
 * `contracts.json`: a second one costs a template, not another copy of the
 * server and the contract set.
 */
const PAGES = ['index.html']
  .map((name) => ({ name, path: resolve(here, '../mock', name) }))
  .filter((page) => existsSync(page.path));

/**
 * The mock server's browser entry, resolved by the name a consumer would use
 * rather than by walking up to a sibling directory. If `./browser` ever stops
 * being exported, this fails here instead of producing a page that cannot be
 * built the documented way.
 */
const MOCK_ENTRY = resolve(here, '../mock/runtime.js');

// Asserted rather than used: the runtime shim imports by package name, and
// this fails the build loudly if that export ever stops existing.
import.meta.resolve('@codeforamerica/blueprint-mock-server/browser');
import.meta.resolve('@codeforamerica/blueprint-core/browser');

/** Where `blueprint-bundle-contracts` lives in this workspace. */
const BUNDLE_CONTRACTS = resolve(here, '../../blueprint-cli/scripts/bundle-contracts.js');

const USAGE = `
Build the harness demo page: the mock server running in a browser.

Usage:
  node scripts/build-mock-page.js --spec=<dir> --out=<dir> [--domain=<name>...]

Options:
  --spec=<dir>      Resolved contracts directory. Repeatable.
  --source=<dir>    The authored contracts, carried alongside the resolved
                    ones so the page can show what a document looked like
                    before resolve touched it. Optional.
  --overlay=<dir>   Authored overlays, carried alongside the artifact so the
                    page can show how this deployment customizes the base
                    contracts. Optional — resolve has already applied them.
  --source-url=<u>  Base URL the authored contracts are browsable at, so each
                    step can link to the file it cites. Omit and the page
                    names the file without linking — it cannot guess where a
                    given contract set is published.
  --domain=<name>   Bundle only this domain. Repeatable. Passed to
                    blueprint-bundle-contracts.
  --out=<dir>       Where to write the page.
  --help            Show this message.

Writes index.html, mock.js and contracts.json for serving over http(s), and
standalone.html as a single file that works from file://.
`.trim();

function parseArgs(argv) {
  const options = { specDirs: [], sourceDir: null, overlayDir: null, sourceUrl: null, domains: [], out: null, help: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--spec=')) options.specDirs.push(arg.slice('--spec='.length));
    else if (arg.startsWith('--source=')) options.sourceDir = arg.slice('--source='.length);
    else if (arg.startsWith('--overlay=')) options.overlayDir = arg.slice('--overlay='.length);
    else if (arg.startsWith('--source-url=')) options.sourceUrl = arg.slice('--source-url='.length).replace(/\/$/, '');
    else if (arg.startsWith('--domain=')) options.domains.push(arg.slice('--domain='.length));
    else if (arg.startsWith('--out=')) options.out = arg.slice('--out='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

/** Run a command, exiting with its status if it fails. */
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/**
 * Bundle the mock server's browser entry.
 *
 * @param {'esm'|'iife'} format - IIFE for the standalone build, which reads
 *   the bundle off a global because a static import would be the very fetch
 *   that `file://` forbids.
 * @param {string} outfile
 * @param {string[]} [extra]
 */
function bundle(format, outfile, extra = []) {
  run('npx', [
    'esbuild', MOCK_ENTRY, '--bundle', '--platform=browser', '--minify',
    `--format=${format}`, '--log-level=error', `--outfile=${outfile}`, ...extra,
  ]);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (options.specDirs.length === 0 || !options.out) {
    console.error('Error: --spec=<dir> and --out=<dir> are both required.\n');
    console.error(USAGE);
    process.exit(1);
  }

  const outDir = resolve(options.out);
  mkdirSync(outDir, { recursive: true });

  console.log('Bundling contracts...');
  run(process.execPath, [
    BUNDLE_CONTRACTS,
    ...options.specDirs.map((dir) => `--spec=${dir}`),
    ...options.domains.map((name) => `--domain=${name}`),
    `--out=${join(outDir, 'contracts.json')}`,
  ]);

  // The authored set, for showing what resolve changed. Not validated: these
  // are pre-resolve, so they legitimately carry `${VAR}` placeholders and
  // refs that only resolve once the pipeline has run.
  if (options.sourceDir) {
    console.log('\nBundling the authored contracts...');
    run(process.execPath, [
      BUNDLE_CONTRACTS,
      `--spec=${options.sourceDir}`,
      '--skip-validation',
      `--out=${join(outDir, 'authored.json')}`,
    ]);
  }

  // Overlays are an input, not part of the resolved set — resolve applies them
  // and strips them from its output, which is right. But "this field exists
  // because a state added it" is one of the more interesting things the page
  // has to say, and it could only assert it. Carried separately rather than
  // folded into the artifact, so nothing walking the contract set meets a
  // document that does not describe the running system.
  if (options.overlayDir) {
    const dir = resolve(options.overlayDir);
    const overlays = existsSync(dir)
      ? readdirSync(dir)
          .filter((name) => name.endsWith('.yaml'))
          // `dir` is the overlay directory's own name, so the page can build a
          // link relative to --source-url without being told the layout.
          .map((name) => ({
            name,
            dir: basename(dir),
            content: yaml.load(readFileSync(join(dir, name), 'utf8')),
          }))
      : [];
    writeFileSync(join(outDir, 'overlays.json'), JSON.stringify(overlays));
    console.log(`  ${overlays.length} overlay document(s) from ${dir}`);
  }

  console.log('\nBundling the mock server...');
  bundle('esm', join(outDir, 'mock.js'));

  const config = JSON.stringify({ sourceUrl: options.sourceUrl ?? null });
  const configTag =
    `<script type="application/json" id="page-config">${config.replace(/</g, '\\u003c')}</script>\n`;

  // Injected into every build, so a served page and its single file behave
  // the same. A replacer function, for the reason the standalone build below
  // documents at length.
  const served = PAGES.map((entry) => {
    const page = readFileSync(entry.path, 'utf8')
      .replace('<script type="module">', () => configTag + '<script type="module">');
    writeFileSync(join(outDir, entry.name), page);
    return { ...entry, page };
  });

  console.log('Building the single-file versions...');
  const iife = join(outDir, '.mock.iife.js');
  bundle('iife', iife, ['--global-name=BlueprintMock']);

  const contracts = readFileSync(join(outDir, 'contracts.json'), 'utf8');
  const overlaysPath = join(outDir, 'overlays.json');
  const overlays = existsSync(overlaysPath) ? readFileSync(overlaysPath, 'utf8') : null;
  const authoredPath = join(outDir, 'authored.json');
  const authoredSet = existsSync(authoredPath) ? readFileSync(authoredPath, 'utf8') : null;

  /**
   * A data island, but only for a page that looks for it.
   *
   * The single file has no siblings to fetch, so whatever a page reads has
   * to travel inside it. The converse is the part worth enforcing: a page
   * that never mentions an island should not carry one. The authored set
   * alone is 87 KB, and it stayed inlined for a while after the page that
   * read it was replaced — weight in a file whose whole point is being
   * small enough to send someone.
   *
   * `<` is escaped, which JSON permits as \u003c, so a browser cannot end
   * the element early.
   */
  const island = (page, id, json) => (json && page.includes(id)
    ? [`<script type="application/json" id="${id}">${json.replace(/</g, '\\u003c')}</script>`]
    : []);

  // `</script` escaped for the same reason. Inside a JavaScript string or
  // regex `<\/script` means the same thing, and minified output can only
  // contain the sequence in one of those.
  const bundled = `<script>${readFileSync(iife, 'utf8').replace(/<\/script/gi, '<\\/script')}</script>`;

  // A replacer *function*, not a string. A string replacement treats `$&`,
  // backtick-dollar and `$'` as substitution patterns, and a minified bundle
  // is full of `$` sequences — which spliced the page into the middle of
  // itself and truncated the bundle to 82 KB of 543 KB. Silently: the file
  // was written, looked plausible, and did not run.
  for (const entry of served) {
    const name = entry.name === 'index.html'
      ? 'standalone.html'
      : entry.name.replace(/\.html$/, '-standalone.html');
    const inlined = [
      bundled,
      ...island(entry.page, 'contracts-data', contracts),
      ...island(entry.page, 'overlays-data', overlays),
      ...island(entry.page, 'authored-data', authoredSet),
      '<script type="module">',
    ].join('\n');
    writeFileSync(join(outDir, name), entry.page.replace('<script type="module">', () => inlined));
  }
  rmSync(iife);

  const kb = (file) => Math.round(statSync(join(outDir, file)).size / 1024);
  console.log(`\n✓ ${outDir}`);
  console.log(`  shared:     mock.js ${kb('mock.js')} KB + contracts.json ${kb('contracts.json')} KB`);
  for (const entry of served) {
    const alone = entry.name === 'index.html'
      ? 'standalone.html'
      : entry.name.replace(/\.html$/, '-standalone.html');
    console.log(`  ${entry.name.padEnd(13)} ${kb(entry.name)} KB    ${alone} ${kb(alone)} KB`);
  }
  console.log(`\n  npx serve ${options.out}`);
  console.log(`  open ${join(options.out, 'standalone.html')}`);
}

main();

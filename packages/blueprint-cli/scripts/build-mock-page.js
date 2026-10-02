#!/usr/bin/env node
/**
 * Build a page that runs the mock server, with no server.
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
 *   blueprint-build-mock-page --spec=<dir> --out=<dir> [--domain=<name>]
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The authored page, and the mock server entry to bundle. */
const PAGE = resolve(here, '../../blueprint-harness/mock/index.html');
const MOCK_ENTRY = resolve(here, '../../blueprint-mock-server/src/browser.js');

const USAGE = `
Build a page that runs the mock server in a browser.

Usage:
  blueprint-build-mock-page --spec=<dir> --out=<dir> [--domain=<name>...]

Options:
  --spec=<dir>      Resolved contracts directory. Repeatable.
  --domain=<name>   Bundle only this domain. Repeatable. Passed to
                    blueprint-bundle-contracts.
  --out=<dir>       Where to write the page.
  --help            Show this message.

Writes index.html, mock.js and contracts.json for serving over http(s), and
standalone.html as a single file that works from file://.
`.trim();

function parseArgs(argv) {
  const options = { specDirs: [], domains: [], out: null, help: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--spec=')) options.specDirs.push(arg.slice('--spec='.length));
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
    join(here, 'bundle-contracts.js'),
    ...options.specDirs.map((dir) => `--spec=${dir}`),
    ...options.domains.map((name) => `--domain=${name}`),
    `--out=${join(outDir, 'contracts.json')}`,
  ]);

  console.log('\nBundling the mock server...');
  bundle('esm', join(outDir, 'mock.js'));

  const page = readFileSync(PAGE, 'utf8');
  writeFileSync(join(outDir, 'index.html'), page);

  console.log('Building the single-file version...');
  const iife = join(outDir, '.mock.iife.js');
  bundle('iife', iife, ['--global-name=BlueprintMock']);

  const contracts = readFileSync(join(outDir, 'contracts.json'), 'utf8');

  const inlined = [
    // `</script` escaped so a browser cannot end the element early. Inside a
    // JavaScript string or regex `<\/script` means the same thing, and
    // minified output can only contain the sequence in one of those.
    `<script>${readFileSync(iife, 'utf8').replace(/<\/script/gi, '<\\/script')}</script>`,
    // `<` escaped for the same reason, which JSON permits as \u003c.
    `<script type="application/json" id="contracts-data">${contracts.replace(/</g, '\\u003c')}</script>`,
    '<script type="module">',
  ].join('\n');

  // A replacer *function*, not a string. A string replacement treats `$&`,
  // backtick-dollar and `$'` as substitution patterns, and a minified bundle
  // is full of `$` sequences — which spliced the page into the middle of
  // itself and truncated the bundle to 82 KB of 543 KB. Silently: the file
  // was written, looked plausible, and did not run.
  const standalone = page.replace('<script type="module">', () => inlined);
  writeFileSync(join(outDir, 'standalone.html'), standalone);
  rmSync(iife);

  const kb = (file) => Math.round(statSync(join(outDir, file)).size / 1024);
  console.log(`\n✓ ${outDir}`);
  console.log(`  served:     index.html ${kb('index.html')} KB + mock.js ${kb('mock.js')} KB + contracts.json ${kb('contracts.json')} KB`);
  console.log(`  standalone: standalone.html ${kb('standalone.html')} KB`);
  console.log(`\n  npx serve ${options.out}`);
  console.log(`  open ${join(options.out, 'standalone.html')}`);
}

main();

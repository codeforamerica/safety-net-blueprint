/**
 * try-it/build.js
 *
 * Builds the Try it out page into <contentDir>/try-it/: the mock server
 * running in the page, derived from the contract set. "Show me around" plays
 * the set's Arazzo scenarios a step at a time; "Let me explore" sends any
 * operation a request.
 *
 * Three files, each loaded with a classic <script>, so the page works both
 * served over http(s) and opened from disk (`file://`), where a page cannot
 * fetch or import a file beside it:
 *
 *   index.html    the page
 *   mock.js       the mock server and what the page reads contracts with,
 *                 defining `BlueprintMock` (built by scripts/build-browser.js)
 *   contracts.js  the contract set as one artifact, defining
 *                 `BlueprintContracts`
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { discover, generate, load } from '@codeforamerica/blueprint-core';
import { loadConfig } from '../lib/config.js';
import { buildSpecLink } from '../lib/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The bundle scripts/build-browser.js writes. */
const BUNDLE = resolve(__dirname, '../../dist/try-it-mock.js');

/**
 * @param {{ contentDir: string, resolvedDir: string }} opts
 */
export function build({ contentDir, resolvedDir }) {
  if (!existsSync(BUNDLE)) {
    throw new Error(`Try it out: ${BUNDLE} is missing. Run \`npm run build:browser\` in blueprint-explorer.`);
  }

  const outputDir = join(contentDir, 'try-it');
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  const docs = discover(resolvedDir).map(load);
  const artifact = generate(docs, 'artifact');
  writeFileSync(join(outputDir, 'contracts.js'), `globalThis.BlueprintContracts = ${JSON.stringify(artifact)};\n`);
  copyFileSync(BUNDLE, join(outputDir, 'mock.js'));

  // Where each step's contract file is browsable, from config.yaml's repo,
  // and the scenario Show me around opens with.
  const config = loadConfig(contentDir);
  const sourceUrl = buildSpecLink(config.repo, '')?.replace(/\/$/, '') ?? null;
  const pageConfig = JSON.stringify({ sourceUrl, firstTour: config.first_tour ?? null });
  const page = readFileSync(join(__dirname, 'page.html'), 'utf8').replace(
    '<script type="module">',
    () => `<script type="application/json" id="page-config">${pageConfig.replace(/</g, '\\u003c')}</script>\n` +
      '<script src="mock.js"></script>\n<script src="contracts.js"></script>\n<script type="module">',
  );
  writeFileSync(join(outputDir, 'index.html'), page);

  console.log(`Try it out: ${artifact.docs.length} documents → ${outputDir}`);
}

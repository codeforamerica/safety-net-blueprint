/**
 * try-it/build.js
 *
 * Builds the Scenarios page into <contentDir>/scenarios/: the set's Arazzo
 * scenarios, played a step at a time against the mock server running in the
 * page, derived from the contract set.
 *
 * The mock itself goes in <contentDir>/mock/, for every page that runs it,
 * as two files each loaded with a classic <script>, so a page works both
 * served over http(s) and opened from disk (`file://`), where it cannot
 * fetch or import a file beside it:
 *
 *   mock.js       the mock server and what pages read contracts with,
 *                 defining `BlueprintMock` (built by scripts/build-browser.js)
 *   contracts.js  the contract set as one artifact, defining
 *                 `BlueprintContracts`, and its version as
 *                 `BlueprintContractsVersion`, so records saved against an
 *                 older build are not restored
 *
 * Beside the page goes tours.json, the scenarios the page offers, for
 * the hub's card to link to each with `index.html#tour=<path>`.
 */

import { createHash } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { discover, generate, load } from '@codeforamerica/blueprint-core';
import { loadConfig } from '../lib/config.js';
import { buildSpecLink } from '../lib/paths.js';
import { breadcrumb } from '../lib/html.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The bundle scripts/build-browser.js writes. */
const BUNDLE = resolve(__dirname, '../../dist/try-it-mock.js');

/**
 * @param {{ contentDir: string, resolvedDir: string }} opts
 */
export function build({ contentDir, resolvedDir }) {
  if (!existsSync(BUNDLE)) {
    throw new Error(`Scenarios: ${BUNDLE} is missing. Run \`npm run build:browser\` in blueprint-explorer.`);
  }

  const outputDir = join(contentDir, 'scenarios');
  const mockDir = join(contentDir, 'mock');
  for (const dir of [outputDir, mockDir]) rmSync(dir, { recursive: true, force: true });
  mkdirSync(mockDir, { recursive: true });

  const docs = discover(resolvedDir).map(load);
  const artifact = generate(docs, 'artifact');
  const json = JSON.stringify(artifact);
  const version = createHash('sha256').update(json).digest('hex').slice(0, 16);
  writeFileSync(join(mockDir, 'contracts.js'),
    `globalThis.BlueprintContractsVersion = ${JSON.stringify(version)};\nglobalThis.BlueprintContracts = ${json};\n`);
  copyFileSync(BUNDLE, join(mockDir, 'mock.js'));
  // The mock is for every page that runs it; the Scenarios page only for a set
  // that has scenarios to play.
  const tours = toursIn(docs);
  if (!tours.length) return;
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'tours.json'), JSON.stringify(tours));

  // Where each step's contract file is browsable, from config.yaml's repo,
  // and the scenario the page opens with.
  const config = loadConfig(contentDir);
  const sourceUrl = buildSpecLink(config.repo, '')?.replace(/\/$/, '') ?? null;
  // The API reference pages built before this one, so a step can link to its
  // operation's page only when there is one.
  const apiDir = join(contentDir, 'api-reference');
  const apiPages = existsSync(apiDir)
    ? readdirSync(apiDir).filter((name) => name.endsWith('.html') && name !== 'index.html').map((name) => name.slice(0, -'.html'.length))
    : [];
  const pageConfig = JSON.stringify({ sourceUrl, firstTour: config.first_tour ?? null, apiPages });
  // The same way back to the explorer every other page has.
  const crumbs = breadcrumb([{ label: 'Explorer', href: '../index.html' }, { label: 'Scenarios' }]);
  const page = readFileSync(join(__dirname, 'page.html'), 'utf8').replace('<body>', () => `<body>\n${crumbs}`).replace(
    '<script type="module">',
    () => `<script type="application/json" id="page-config">${pageConfig.replace(/</g, '\\u003c')}</script>\n` +
      '<script src="../mock/mock.js"></script>\n<script src="../mock/contracts.js"></script>\n<script type="module">',
  );
  writeFileSync(join(outputDir, 'index.html'), page);

  console.log(`Scenarios: ${artifact.docs.length} documents → ${outputDir}`);
}

/**
 * The scenarios the page offers, as it finds them: every Arazzo
 * document but one that others name as a source of type arazzo, which holds
 * workflows they run inside their own steps.
 *
 * @param {import('@codeforamerica/blueprint-core').Doc[]} docs
 * @returns {{ path: string, title: string }[]}
 */
function toursIn(docs) {
  const fileName = (path) => String(path ?? '').split(/[?#]/)[0].split('/').pop();
  const arazzo = docs.filter((doc) => doc.type === 'arazzo');
  const runIn = new Set(arazzo.flatMap((doc) => (doc.content.sourceDescriptions ?? [])
    .filter((source) => source.type === 'arazzo').map((source) => fileName(source.url))));
  return arazzo
    .filter((doc) => !runIn.has(fileName(doc.relativePath)))
    .map((doc) => ({ path: doc.relativePath, title: doc.content.info?.title ?? fileName(doc.relativePath) }));
}

/**
 * The explorer build has to finish, and what it writes has to be reachable.
 *
 * A tool that found nothing to document used to end the build by calling
 * `process.exit(0)` — in-process, so it took every later tool with it, and
 * with a success status, so the build script, the pre-push hook and preflight
 * all recorded a pass. The published site kept an API reference reading "0
 * contract domains" for five weeks and nothing reported a problem.
 *
 * So these run the build the way the build script does, as a child process,
 * against a contract set that gives several tools nothing to do.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const buildScript = resolve(here, '../../build.js');

/** A contract set with two domains, no rule graphs and no state machines. */
function writeContracts(dir) {
  for (const [domain, paths] of [['intake', { '/applications': { get: { responses: {} } } }], ['platform', {}]]) {
    const domainDir = join(dir, 'domains', domain);
    mkdirSync(domainDir, { recursive: true });
    writeFileSync(join(domainDir, `${domain}-openapi.yaml`), [
      'openapi: 3.1.0',
      'info:',
      `  title: ${domain} API`,
      '  version: 1.0.0',
      `  x-domain: ${domain}`,
      `paths: ${JSON.stringify(paths)}`,
      'components:',
      '  schemas:',
      '    Thing: { type: object }',
      '    ThingList: { type: object }',
      '',
    ].join('\n'));
  }
}

function writeContent(dir) {
  mkdirSync(join(dir, 'context-map', 'config'), { recursive: true });
  writeFileSync(join(dir, 'config.yaml'), [
    'name: "Fixture"',
    'repo:',
    '  url: "https://example.test/fixture"',
    'domains: []',
    '',
  ].join('\n'));
  writeFileSync(join(dir, 'context-map', 'config', 'config.yaml'), 'title: "Fixture map"\nsubtitle: "x"\n');
}

/** Every file under a directory, as paths relative to it. */
function filesUnder(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full, base) : [relative(base, full)];
  });
}

describe('the explorer build', () => {
  let contractsDir;
  let contentDir;
  let output;

  before(() => {
    const root = mkdtempSync(join(tmpdir(), 'explorer-build-'));
    contractsDir = join(root, 'contracts');
    contentDir = join(root, 'content');
    mkdirSync(contractsDir, { recursive: true });
    writeContracts(contractsDir);
    writeContent(contentDir);

    output = execFileSync(process.execPath, [
      buildScript, `--content=${contentDir}`, `--resolved=${contractsDir}`,
    ], { encoding: 'utf8' });
  });

  after(() => {
    if (contentDir) rmSync(resolve(contentDir, '..'), { recursive: true, force: true });
  });

  it('reaches the end when a tool has nothing to document', () => {
    // The hub is built last, so its presence is the proof the build ran out.
    assert.ok(existsSync(join(contentDir, 'index.html')), 'the hub was never written');
  });

  it('says what it skipped rather than stopping', () => {
    assert.match(output, /skipping rules-docs/);
    assert.match(output, /skipping state-machine-docs/);
  });

  it('writes an API reference describing the domains it was given', () => {
    const html = readFileSync(join(contentDir, 'api-reference', 'index.html'), 'utf8');

    assert.match(html, /for 2 contract domains/);
  });

  it('leaves no link pointing at a page that was not written', () => {
    const dangling = [];
    for (const page of filesUnder(contentDir).filter(f => f.endsWith('.html'))) {
      const html = readFileSync(join(contentDir, page), 'utf8');
      for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
        if (/^(https?:|mailto:|#|data:)/.test(href)) continue;
        const target = resolve(dirname(join(contentDir, page)), href.split('#')[0]);
        if (!existsSync(target)) dangling.push(`${page} → ${href}`);
      }
    }

    assert.deepEqual(dangling, []);
  });

  it('draws every domain the contracts declare, and only those', () => {
    const overview = readFileSync(join(contentDir, 'context-map', 'domains.html'), 'utf8');

    assert.match(overview, /Intake/);
    assert.match(overview, /Platform/);
    assert.doesNotMatch(overview, /Appeals|Benefits/);
  });
});

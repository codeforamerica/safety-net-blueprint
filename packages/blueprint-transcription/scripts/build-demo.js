#!/usr/bin/env node
/**
 * Build the demo page as one file that opens from disk: demo/index.html with
 * the page's script bundled into it, and the worker's — the state's side —
 * bundled into that as text, which the page starts from a blob. Both carry
 * the package's code, the mock, and the harness's contracts; the page also
 * carries the SDK generated from them (npm run sdk). Written to demo/dist/,
 * which isn't committed.
 *
 * Usage: npm run build:demo -w packages/blueprint-transcription
 */

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const demo = join(root, 'demo');

execFileSync(process.execPath, [join(root, 'scripts', 'generate-sdk.js')], { stdio: 'inherit' });

const common = {
  bundle: true,
  platform: 'browser',
  format: 'iife',
  minify: true,
  write: false,
  loader: { '.md': 'text' },
  logLevel: 'error',
};

const worker = await build({ ...common, entryPoints: [join(demo, 'server.worker.js')] });
const page = await build({
  ...common,
  entryPoints: [join(demo, 'demo.js')],
  define: { WORKER_SOURCE: JSON.stringify(worker.outputFiles[0].text) },
});

// `</script` inside the bundle would end the tag early.
const script = `<script>${page.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`;
const html = readFileSync(join(demo, 'index.html'), 'utf8').replace('<!-- demo.js -->', () => script);
mkdirSync(join(demo, 'dist'), { recursive: true });
writeFileSync(join(demo, 'dist', 'index.html'), html);
console.log(`Built demo/dist/index.html (${Math.round(html.length / 1024)} KB)`);

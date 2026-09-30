#!/usr/bin/env node
/**
 * Authored pages build.
 *
 * Copies blueprint-explorer/authored/ into <contentDir>/authored/.
 * These are universal pages (adoption model, executive summary) that apply
 * to any state deployment.
 *
 * Performs token substitution on HTML files using values from config.yaml:
 *   {{project_name}}  → config.name
 *   {{repo_url}}      → config.repo.url (or empty string)
 *   {{repo_branch}}   → config.repo.branch (or "main")
 *
 * Usage:
 *   node authored.js --content=<path>
 */

import { readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from './lib/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * @param {{ contentDir: string, authoredDir?: string }} opts
 */
export function build({ contentDir, authoredDir }) {
  // Default authored source is the package's own authored/ directory.
  const srcDir = authoredDir ?? resolve(__dirname, '..', 'authored');

  const { name: projectName, repo } = loadConfig(contentDir);
  const repoUrl    = repo?.url    ?? '';
  const repoBranch = repo?.branch ?? 'main';

  const outDir = join(contentDir, 'authored');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  for (const file of readdirSync(srcDir)) {
    const src = join(srcDir, file);
    const dst = join(outDir, file);
    if (file.endsWith('.html')) {
      const content = readFileSync(src, 'utf8')
        .replaceAll('{{project_name}}', projectName)
        .replaceAll('{{repo_url}}',     repoUrl)
        .replaceAll('{{repo_branch}}',  repoBranch);
      writeFileSync(dst, content, 'utf8');
    } else {
      writeFileSync(dst, readFileSync(src));
    }
  }
  console.log('  wrote authored/');
}

// CLI entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const contentArg  = process.argv.find(a => a.startsWith('--content='));
  const authoredArg = process.argv.find(a => a.startsWith('--authored='));
  if (!contentArg) {
    console.error('Usage: node authored.js --content=<path> [--authored=<source-dir>]');
    process.exit(1);
  }
  build({
    contentDir:  resolve(process.cwd(), contentArg.slice('--content='.length)),
    authoredDir: authoredArg ? resolve(process.cwd(), authoredArg.slice('--authored='.length)) : undefined,
  });
}

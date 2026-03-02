import type { Plugin } from 'vite';
import { writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { exec } from 'node:child_process';
import yaml from 'js-yaml';
import { dirs } from '../storybook/config.js';

/**
 * Valid custom story file pattern:
 *   custom/{contractId}.{customName}/{type}.yaml
 * where type is one of: test-data, permissions, layout
 */
const CUSTOM_FILE_RE =
  /^custom\/[a-z0-9-]+\.[a-z0-9-]+\/(test-data|permissions|layout)\.yaml$/;

/** Validate a custom story directory name like "application-intake.citizen". */
const CUSTOM_DIR_RE = /^[a-z0-9-]+\.[a-z0-9-]+$/;

/** Read a JSON body from an incoming request. */
async function readBody(req: NodeJS.ReadableStream): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

/** Run story generation. Returns a promise when awaited, or fires-and-forgets if not. */
function regenerateStories(root: string): Promise<void> {
  return new Promise((resolve) => {
    exec('node storybook/scripts/generate-stories.js', { cwd: root }, (err, stdout) => {
      if (err) {
        console.error('[save-contract] Story generation failed:', err.message);
      } else {
        console.log('[save-contract] Stories regenerated:\n' + stdout);
      }
      resolve();
    });
  });
}

/** Convert kebab-case to Title Case display name. */
function toDisplayName(kebab: string): string {
  return kebab.replace(/-/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * Collect all story display names (base + custom) in the same role/category
 * as the given contractId. Used to prevent title collisions in the sidebar.
 * @param excludeCustomDir - custom dir name to exclude (for rename checks)
 */
function collectCategoryNames(root: string, contractId: string, excludeCustomDir?: string): Set<string> {
  const names = new Set<string>();
  const contractsDir = resolve(root, dirs.contracts);
  if (!existsSync(contractsDir)) return names;

  // Build map: contractId → { title, role, category }
  const contracts = new Map<string, { title: string; role: string; category: string }>();
  for (const domain of readdirSync(contractsDir)) {
    const domainPath = resolve(contractsDir, domain);
    if (!statSync(domainPath).isDirectory()) continue;
    for (const file of readdirSync(domainPath)) {
      if (!file.endsWith('.manifest.yaml')) continue;
      const manifest = yaml.load(readFileSync(resolve(domainPath, file), 'utf-8')) as Record<string, unknown>;
      const category = (manifest?.category as string) ?? '';
      const contractPath = (manifest?.sources as Record<string, unknown>)?.contract as string;
      if (!contractPath) continue;
      const formPath = resolve(root, contractPath);
      if (!existsSync(formPath)) continue;
      const form = (yaml.load(readFileSync(formPath, 'utf-8')) as Record<string, unknown>)?.form as Record<string, unknown>;
      if (!form?.id || !form?.title || !form?.role) continue;
      contracts.set(form.id as string, {
        title: form.title as string,
        role: form.role as string,
        category,
      });
    }
  }

  const target = contracts.get(contractId);
  if (!target) return names;

  // Collect base story titles in the same role/category
  for (const info of contracts.values()) {
    if (info.role === target.role && info.category === target.category) {
      names.add(info.title.toLowerCase());
    }
  }

  // Collect existing custom story display names in the same role/category
  const customBase = resolve(root, dirs.custom);
  if (existsSync(customBase)) {
    for (const entry of readdirSync(customBase)) {
      if (excludeCustomDir && entry === excludeCustomDir) continue;
      const dotIdx = entry.indexOf('.');
      if (dotIdx === -1) continue;
      const entryContractId = entry.slice(0, dotIdx);
      const entryCustomName = entry.slice(dotIdx + 1);
      const entryInfo = contracts.get(entryContractId);
      if (!entryInfo || entryInfo.role !== target.role || entryInfo.category !== target.category) continue;
      names.add(toDisplayName(entryCustomName).toLowerCase());
    }
  }

  return names;
}

/**
 * Vite dev server plugin that exposes custom story management endpoints.
 * Source-of-truth files (contracts, fixtures, permissions) are read-only.
 * Only custom story directories under storybook/custom/ can be written/renamed/deleted.
 */
export function saveContractPlugin(): Plugin {
  return {
    name: 'save-contract',
    configureServer(server) {
      // ----- POST /__save-contract — save a custom story file -----------------
      server.middlewares.use('/__save-contract', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        try {
          const body = await readBody(req);
          const content = body.content as string;
          const filename = body.filename as string;

          if (!CUSTOM_FILE_RE.test(filename)) {
            res.statusCode = 403;
            res.end(`File not allowed: ${filename}`);
            return;
          }

          // Validate YAML parses
          const parsed = yaml.load(content);
          if (!parsed || typeof parsed !== 'object') {
            res.statusCode = 422;
            res.end('Invalid YAML: expected an object');
            return;
          }

          // Extra validation for layout files
          if (filename.endsWith('/layout.yaml')) {
            const doc = parsed as Record<string, unknown>;
            if (!doc.form || typeof doc.form !== 'object') {
              res.statusCode = 422;
              res.end('Invalid layout: missing form object');
              return;
            }
            const form = doc.form as Record<string, unknown>;
            if (!Array.isArray(form.pages)) {
              res.statusCode = 422;
              res.end('Invalid layout: missing form.pages array');
              return;
            }
          }

          const filePath = resolve(server.config.root, dirs.custom, filename.slice('custom/'.length));
          await mkdir(dirname(filePath), { recursive: true });
          await writeFile(filePath, content, 'utf-8');

          await regenerateStories(server.config.root);

          res.statusCode = 200;
          res.end('OK');
        } catch (e) {
          if (e instanceof yaml.YAMLException) {
            res.statusCode = 422;
            res.end(`Invalid YAML: ${e.message}`);
            return;
          }
          res.statusCode = 500;
          res.end(String(e));
        }
      });

      // ----- POST /__check-custom — check if a custom story directory exists ---
      server.middlewares.use('/__check-custom', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        try {
          const body = await readBody(req);
          const dir = body.dir as string;

          if (!CUSTOM_DIR_RE.test(dir)) {
            res.statusCode = 400;
            res.end('Invalid custom story name');
            return;
          }

          const fullPath = resolve(server.config.root, dirs.custom, dir);
          if (existsSync(fullPath)) {
            res.statusCode = 409;
            res.end('A custom story with that name already exists');
            return;
          }

          // Check for title collision with base stories and other custom stories
          const dotIdx = dir.indexOf('.');
          const contractId = dir.slice(0, dotIdx);
          const customName = dir.slice(dotIdx + 1);
          const displayName = toDisplayName(customName);
          const existing = collectCategoryNames(server.config.root, contractId);
          if (existing.has(displayName.toLowerCase())) {
            res.statusCode = 409;
            res.end(`The name "${displayName}" is already used by another story in this category`);
            return;
          }

          res.statusCode = 200;
          res.end('OK');
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e));
        }
      });

      // ----- POST /__rename-custom — rename a custom story directory ----------
      server.middlewares.use('/__rename-custom', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        try {
          const body = await readBody(req);
          const from = body.from as string;
          const to = body.to as string;

          if (!CUSTOM_DIR_RE.test(from) || !CUSTOM_DIR_RE.test(to)) {
            res.statusCode = 400;
            res.end('Invalid custom story name');
            return;
          }

          const srcDir = resolve(server.config.root, dirs.custom, from);
          const destDir = resolve(server.config.root, dirs.custom, to);

          // Reject if destination already exists (name collision)
          if (existsSync(destDir)) {
            res.statusCode = 409;
            res.end('A custom story with that name already exists');
            return;
          }

          // Check for title collision (exclude current dir from the check)
          const dotIdx = to.indexOf('.');
          const contractId = to.slice(0, dotIdx);
          const customName = to.slice(dotIdx + 1);
          const displayName = toDisplayName(customName);
          const existing = collectCategoryNames(server.config.root, contractId, from);
          if (existing.has(displayName.toLowerCase())) {
            res.statusCode = 409;
            res.end(`The name "${displayName}" is already used by another story in this category`);
            return;
          }

          // Remove co-located story file before rename (will be regenerated)
          await rm(resolve(srcDir, 'index.stories.tsx'), { force: true });
          await rename(srcDir, destDir);

          // Respond immediately — regeneration happens in background so the
          // client can navigate before HMR fires for the removed old story.
          res.statusCode = 200;
          res.end('OK');
          regenerateStories(server.config.root);
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e));
        }
      });

      // ----- POST /__delete-custom — delete a custom story directory ----------
      server.middlewares.use('/__delete-custom', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        try {
          const body = await readBody(req);
          const custom = body.custom as string;

          if (!CUSTOM_DIR_RE.test(custom)) {
            res.statusCode = 400;
            res.end('Invalid custom story name');
            return;
          }

          // rm -rf the entire custom story directory (includes co-located story)
          const customDir = resolve(server.config.root, dirs.custom, custom);
          await rm(customDir, { recursive: true, force: true });

          await regenerateStories(server.config.root);

          res.statusCode = 200;
          res.end('OK');
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e));
        }
      });
    },
  };
}

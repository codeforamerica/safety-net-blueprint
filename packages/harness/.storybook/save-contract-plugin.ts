import type { Plugin } from 'vite';
import { writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { exec } from 'node:child_process';
import yaml from 'js-yaml';
import { dirs } from '../storybook/config.js';

/**
 * Valid scenario file pattern:
 *   scenarios/{contractId}.{scenarioName}/{type}.yaml
 * where type is one of: test-data, permissions, layout
 */
const SCENARIO_FILE_RE =
  /^scenarios\/[a-z0-9-]+\.[a-z0-9-]+\/(test-data|permissions|layout)\.yaml$/;

/** Validate a scenario directory name like "person-intake.citizen". */
const SCENARIO_DIR_RE = /^[a-z0-9-]+\.[a-z0-9-]+$/;

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

/**
 * Vite dev server plugin that exposes scenario management endpoints.
 * Source-of-truth files (contracts, fixtures, permissions) are read-only.
 * Only scenario directories under storybook/scenarios/ can be written/renamed/deleted.
 */
export function saveContractPlugin(): Plugin {
  return {
    name: 'save-contract',
    configureServer(server) {
      // ----- POST /__save-contract — save a scenario file -------------------
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

          if (!SCENARIO_FILE_RE.test(filename)) {
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

          const filePath = resolve(server.config.root, dirs.scenarios, filename.slice('scenarios/'.length));
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

      // ----- POST /__rename-scenario — rename a scenario directory ----------
      server.middlewares.use('/__rename-scenario', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        try {
          const body = await readBody(req);
          const from = body.from as string;
          const to = body.to as string;

          if (!SCENARIO_DIR_RE.test(from) || !SCENARIO_DIR_RE.test(to)) {
            res.statusCode = 400;
            res.end('Invalid scenario name');
            return;
          }

          const srcDir = resolve(server.config.root, dirs.scenarios, from);
          const destDir = resolve(server.config.root, dirs.scenarios, to);

          // Remove co-located story file before rename (will be regenerated)
          await rm(resolve(srcDir, 'index.stories.tsx'), { force: true });
          await rename(srcDir, destDir);

          await regenerateStories(server.config.root);

          res.statusCode = 200;
          res.end('OK');
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e));
        }
      });

      // ----- POST /__delete-scenario — delete a scenario directory ----------
      server.middlewares.use('/__delete-scenario', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        try {
          const body = await readBody(req);
          const scenario = body.scenario as string;

          if (!SCENARIO_DIR_RE.test(scenario)) {
            res.statusCode = 400;
            res.end('Invalid scenario name');
            return;
          }

          // rm -rf the entire scenario directory (includes co-located story)
          const scenarioDir = resolve(server.config.root, dirs.scenarios, scenario);
          await rm(scenarioDir, { recursive: true, force: true });

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

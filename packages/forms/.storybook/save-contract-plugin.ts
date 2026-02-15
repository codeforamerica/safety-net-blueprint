import type { Plugin } from 'vite';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

/**
 * Vite dev server plugin that exposes POST /__save-contract.
 * Writes edited YAML content back to src/contracts/person-intake.yaml.
 * The file write triggers Vite HMR, which hot-reloads the YAML import.
 */
export function saveContractPlugin(): Plugin {
  return {
    name: 'save-contract',
    configureServer(server) {
      const contractPath = resolve(
        server.config.root,
        'src/contracts/person-intake.yaml',
      );

      server.middlewares.use('/__save-contract', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk as Buffer);
        }

        try {
          const body = JSON.parse(Buffer.concat(chunks).toString());
          const content = body.content as string;

          // Validate YAML parses and has expected structure
          const parsed = yaml.load(content) as Record<string, unknown>;
          if (!parsed?.form || typeof parsed.form !== 'object') {
            res.statusCode = 422;
            res.end('Invalid contract: missing form object');
            return;
          }
          const form = parsed.form as Record<string, unknown>;
          if (!Array.isArray(form.pages)) {
            res.statusCode = 422;
            res.end('Invalid contract: missing form.pages array');
            return;
          }

          await writeFile(contractPath, content, 'utf-8');
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
    },
  };
}

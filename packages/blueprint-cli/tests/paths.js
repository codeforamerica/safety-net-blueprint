/**
 * Shared path constants for blueprint-cli integration tests.
 *
 * All test files that reference the harness should import from here
 * so path changes only need to be made in one place.
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const harnessDir         = join(__dirname, '../../blueprint-harness');
export const contractsDir       = join(harnessDir, 'contracts');
export const resolvedDir        = join(harnessDir, 'generated/resolved');
export const bundledDir         = join(harnessDir, 'generated/bundled');
export const overlaysDir        = join(harnessDir, 'generated/overlays');
export const clientsDir         = join(harnessDir, 'generated/clients');
export const postmanDir         = join(harnessDir, 'generated/postman');
export const schemasDir         = join(harnessDir, 'generated/schemas');
export const harnessAuthoredDir = join(harnessDir, 'explorer');
export const explorerConfigPath = join(harnessDir, 'explorer/config.yaml');
export const explorerDir        = join(harnessDir, 'generated/explorer');

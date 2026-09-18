/**
 * Shared path constants for blueprint-explorer golden tests.
 *
 * All test files that reference the harness should import from here
 * so path changes only need to be made in one place.
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const harnessDir       = join(__dirname, '../../blueprint-harness');
export const resolvedDir      = join(harnessDir, 'generated/resolved');
export const clientsDir       = join(harnessDir, 'generated/clients');
export const explorerConfigPath = join(harnessDir, 'explorer/config.yaml');

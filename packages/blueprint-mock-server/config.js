/**
 * Canonical path configuration for blueprint-mock-server.
 *
 * All scripts and tests should import paths from here rather than
 * computing them inline, so there is one place to update if directories change.
 */

import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..', '..');

/** Resolved/generated contracts — output of `npm run resolve` */
export const generatedContractsDir = resolve(projectRoot, 'packages', 'generated', 'contracts');

/** Raw source contracts — input to resolve pipeline */
export const rawContractsDir = resolve(projectRoot, 'packages', 'safety-net-contracts');

/** Default seed data directory for the mock server */
export const defaultSeedDir = resolve(__dirname, 'seed');

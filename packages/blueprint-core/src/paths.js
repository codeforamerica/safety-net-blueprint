/**
 * Bundled directory locations and the canonical-URL resolver map.
 *
 * `resolverMap` is internal — `load` and `validate` use it to resolve
 * blueprint.codeforamerica.org URLs against the bundled directories without
 * network access. It is not part of the package's public surface.
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const schemasDir = join(__dirname, '../schemas');
export const baseContractsDir = join(__dirname, '../base-contracts');

export const resolverMap = {
  'https://blueprint.codeforamerica.org/schemas/': schemasDir + '/',
  'https://blueprint.codeforamerica.org/base/': baseContractsDir + '/',
};

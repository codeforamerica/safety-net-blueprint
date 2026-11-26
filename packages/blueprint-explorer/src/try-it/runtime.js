/**
 * What the pages need in a browser, in one bundle.
 *
 * The explorer's pages that run the mock load this as `mock/mock.js`, which
 * defines the `BlueprintMock` global. It exists because the explorer re-scopes
 * the contract set when you change which domains are loaded — that is
 * `extract` and `generate`, which live in blueprint-core, not in the mock
 * server. Bundling a shim rather than two files keeps one script tag per
 * page and one copy of the shared dependencies.
 *
 * Imported by package name, so a removed or renamed browser export fails
 * here at build time instead of producing a page that cannot be built the
 * documented way.
 */
export { createMockServer, runScenario, startScenario, operationIndex, controlOperations } from '@codeforamerica/blueprint-mock-server/server';
export { extract, generate } from '@codeforamerica/blueprint-core/browser';
export { startMock } from './start-mock.js';
export { awayFrom } from './routing.js';
export { mountSendPanels } from './send-panel.js';
export { setTryIt, hostMock, mockChanged } from './control-panel.js';
export { logRequest } from './activity.js';
export { inEnvironment, chooseEnvironment, environments } from './environments.js';
export { signInFromHeader, canSignIn } from './sign-in.js';

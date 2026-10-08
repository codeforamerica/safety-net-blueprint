/**
 * What the pages need in a browser, in one bundle.
 *
 * Both pages load this as `mock.js` (or as the inlined `BlueprintMock`
 * global in the single-file build). It exists because the explorer re-scopes
 * the contract set when you change which domains are loaded — that is
 * `extract` and `generate`, which live in blueprint-core, not in the mock
 * server. Bundling a shim rather than two files keeps one script tag per
 * page and one copy of the shared dependencies.
 *
 * Imported by package name, so a removed or renamed browser export fails
 * here at build time instead of producing a page that cannot be built the
 * documented way.
 */
export { createMockServer } from '@codeforamerica/blueprint-mock-server/browser';
export { extract, generate } from '@codeforamerica/blueprint-core/browser';

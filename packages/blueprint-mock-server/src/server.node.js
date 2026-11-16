/**
 * The server's side, in Node: everything server.js exports, and the HTTP
 * server that serves contract folders on a port, which needs Node's own
 * modules. `./server` resolves here in Node and to server.js anywhere else,
 * by package.json's export conditions, so a page that imports it never
 * bundles `node:http`.
 */

export * from './server.js';
export { startMockServer, stopServer, isServerRunning } from '../cli/server.js';

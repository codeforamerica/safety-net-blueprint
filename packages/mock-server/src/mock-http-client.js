/**
 * HTTP client with stub interception.
 *
 * Event handlers use this instead of calling fetch directly. When an HTTP stub
 * is registered for the target method + URL, the stub response is returned
 * immediately without making a real network call. If no stub matches, a 501
 * error is returned — register a stub before triggering the flow.
 *
 * See packages/mock-server/mock-rules/README.md for stub registration examples.
 */

import { matchAndPopHttp } from './mock-stub-engine.js';

/**
 * Make an outbound HTTP call, returning the stub response if one is registered.
 *
 * @param {string} method  - HTTP method (e.g., "POST")
 * @param {string} url     - Full URL or path (e.g., "http://adapter.example.com/evaluate/expedited-screening")
 * @param {*} [body]       - Request body (JSON-serializable)
 * @returns {Promise<{status: number, body: *}>}
 */
export async function callHttp(method, url, body) {
  // Normalize to path-only for stub matching (stubs register against paths, not full URLs)
  let matchUrl;
  try {
    matchUrl = new URL(url).pathname;
  } catch {
    matchUrl = url;
  }

  const stub = matchAndPopHttp(method, matchUrl);
  if (stub) {
    return {
      status: stub.response?.status ?? 200,
      body: stub.response?.body ?? {},
    };
  }

  return {
    status: 501,
    body: {
      code: 'NOT_IMPLEMENTED',
      message: `No stub registered for ${method} ${matchUrl}. Register an HTTP stub before triggering this flow.`,
    },
  };
}

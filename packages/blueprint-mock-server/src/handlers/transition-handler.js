/**
 * Handler for POST /resources/{id}/{trigger} (state machine transitions)
 */

import { executeTransition } from '../state-machine-runner.js';
import { matchAndPopHttp } from '../mock-stub-engine.js';
import { extractCallerRoles, callerHeader } from '../auth-context.js';
import { assertFetchShaped, jsonBody } from '../http/request.js';

/**
 * Create a transition handler for an RPC endpoint.
 * @param {string} resourceName - Database resource name (e.g., "tasks")
 * @param {Object} stateMachine - The state machine contract
 * @param {string} trigger - Transition trigger name (e.g., "claim")
 * @param {string} paramName - URL parameter name for the resource ID
 * @param {Array} [slaTypes] - SLA types from discoverSlaTypes()
 * @returns {(request: Request, ctx: { params: Record<string,string> }) => Promise<Response>}
 */
export function createTransitionHandler(resourceName, stateMachine, trigger, paramName, slaTypes = [], machine = null, { store } = {}) {
  return async (request, { params }) => {
    const { pathname } = new URL(assertFetchShaped(request, 'createTransitionHandler').url);

    const httpStub = matchAndPopHttp(request.method, pathname);
    if (httpStub) {
      return Response.json(httpStub.response?.body ?? {}, { status: httpStub.response?.status ?? 200 });
    }

    const resourceId = params[paramName];

    const callerId = callerHeader(request, 'x-caller-id');
    if (!callerId) {
      return Response.json({
        code: 'BAD_REQUEST',
        message: 'X-Caller-Id header is required for state transitions'
      }, { status: 400 });
    }

    const callerRoles = extractCallerRoles(request);

    const now = new Date().toISOString();
    const traceparent = callerHeader(request, 'traceparent');

    const { success, result, status, error } = executeTransition({
      store,
      resourceName,
      resourceId,
      trigger,
      callerId,
      callerRoles,
      now,
      stateMachine,
      machine,
      slaTypes,
      requestBody: await jsonBody(request),
      traceparent
    });

    if (!success) {
      return Response.json({ code: statusCode(status), message: error }, { status });
    }

    return Response.json(result);
  };
}

function statusCode(status) {
  if (status === 404) return 'NOT_FOUND';
  if (status === 403) return 'FORBIDDEN';
  return 'CONFLICT';
}

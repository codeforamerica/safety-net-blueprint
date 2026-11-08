/**
 * The transcripts adapter: the contract in
 * communication-transcripts-adapter-openapi.yaml, as a function of
 * `fetch`'s shape, `(Request) => Response`, so it runs on whatever host a
 * state chooses — a Node server, a serverless function, a worker. The state
 * runs it, holds its secrets, and decides where it's served.
 *
 * It answers POST /issue-connection with the issuer for the service the
 * request names, and echoes the request's metadata, as every adapter does.
 */

/**
 * What an issuer throws for a request its service can't take — an encoding it
 * doesn't stream, say — answered 422 naming the field.
 */
export class CantIssue extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'CantIssue';
    this.field = field;
  }
}

const error = (status, code, message, details) => Response.json(
  { code, message, ...(details && { details }) },
  { status },
);

/**
 * @param {object} options
 * @param {Record<string, Function>} options.issuers - by transcription
 *   service, a function from a ConnectionRequest to a StreamConnection, such
 *   as `transcribeIssuer(...)` for `aws-transcribe`
 * @returns {(request: Request) => Promise<Response>}
 */
export function createTranscriptsAdapter({ issuers }) {
  return async (request) => {
    const { pathname } = new URL(request.url);
    if (!pathname.endsWith('/issue-connection')) return error(404, 'NOT_FOUND', `Nothing at ${pathname}`);
    if (request.method !== 'POST') return error(405, 'METHOD_NOT_ALLOWED', 'issue-connection takes POST');

    let body;
    try {
      body = await request.json();
    } catch {
      return error(400, 'BAD_REQUEST', 'The body isn\'t JSON');
    }
    const missing = ['provider', 'audio', 'protocols'].filter((field) => body?.[field] === undefined);
    if (missing.length) {
      return error(400, 'BAD_REQUEST', 'The request is missing what a connection needs',
        missing.map((field) => ({ field, message: 'is required' })));
    }

    const issue = issuers[body.provider];
    if (!issue) {
      return error(422, 'UNPROCESSABLE_ENTITY', `This adapter doesn't issue connections to ${body.provider}`,
        [{ field: 'provider', message: `takes ${Object.keys(issuers).join(', ')}` }]);
    }
    try {
      const { metadata, ...asked } = body;
      return Response.json({ metadata: metadata ?? {}, ...await issue(asked) });
    } catch (e) {
      if (e instanceof CantIssue) return error(422, 'UNPROCESSABLE_ENTITY', e.message, [{ field: e.field, message: e.message }]);
      console.error(e);
      return error(500, 'INTERNAL_ERROR', 'The connection couldn\'t be issued');
    }
  };
}

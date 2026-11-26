/**
 * A fake transcription service behind sign-in: a transcription session
 * adapter for a profile whose provider is `fake-secured`
 * (communication-transcription-sessions-adapter-openapi.yaml). It stands in
 * for a service a state hosts, so a session under it shows what signing in
 * looks like: its credentials go only to a signed-in caller, as a real
 * credentials service's do. Once it has one, it sends a few set lines, one
 * every two seconds, until stopped. It hears nothing.
 *
 * The harness site routes the session adapter to it (../routing.yaml):
 *
 *   routing:
 *     - api: communication-transcription-sessions-adapter
 *       match: { provider: fake-secured }
 *       handler: ./adapters/fake-secured.js
 *
 * Each handler gets the request and `{ params, publish, call }` from routing:
 * `publish` sends one of the session's events, `call` calls another operation
 * by its operationId, wherever routing sends it.
 */

const LINES = [
  { speaker: 'staff', text: 'Can you tell me who lives with you?' },
  { speaker: 'client', text: 'My sister and her two kids.' },
  { speaker: 'staff', text: 'Does anyone in the household work?' },
  { speaker: 'client', text: 'I work at the grocery store, about thirty hours a week.' },
];
const EVERY_MS = 2000;

/** Each session's stop, while it's sending lines, and its transcript. */
const running = new Map();
const transcripts = new Map();

/** Publish one of a session's events, about the session, with its transcript. */
const publisher = (context, sessionId) => async (event, data = {}) => {
  const answer = await context.publish(`transcription_session.${event}`, { transcriptId: transcripts.get(sessionId), ...data }, { subject: sessionId });
  if (answer.status >= 400) throw new Error(`publishing ${event} answered ${answer.status}: ${answer.body?.message ?? ''}`.trim());
};

/** Do the work after answering, reporting what goes wrong. */
const later = (work) => setTimeout(() => { work().catch((error) => console.warn(`fake-secured: ${error.message}`)); }, 0);

/** Send the set lines, one at a time, until stopped. */
function sendLines(sessionId, publish) {
  const run = Date.now().toString(36);
  let next = 0;
  const timer = setInterval(() => {
    if (next >= LINES.length) return;
    const { speaker, text } = LINES[next];
    const endedAt = new Date().toISOString();
    const startedAt = new Date(Date.now() - EVERY_MS / 2).toISOString();
    next += 1;
    publish('line_finished', { key: `${run}.l${next}`, text, speaker, startedAt, endedAt }).catch((error) => console.warn(`fake-secured: ${error.message}`));
  }, EVERY_MS);
  running.set(sessionId, () => clearInterval(timer));
}

/** Stop a session's lines, if it's sending them. */
function halt(sessionId) {
  running.get(sessionId)?.();
  running.delete(sessionId);
}

export async function startStream(request, context) {
  const stream = await request.json();
  const sessionId = stream.transcriptionSessionId;
  transcripts.set(sessionId, stream.transcriptId);
  const publish = publisher(context, sessionId);
  later(async () => {
    try {
      const credentials = await context.call('requestCredentials', {
        body: {
          metadata: { transcriptionSessionId: sessionId, transcriptId: stream.transcriptId },
          provider: stream.provider,
          ...(stream.model ? { model: stream.model } : {}),
          ...(stream.languages ? { languages: stream.languages } : {}),
          audio: { encoding: 'linear16', sampleRateHertz: 16000, channelCount: 1 },
          protocols: ['websocket'],
        },
      });
      if (credentials.status >= 400) throw new Error(`requestCredentials answered ${credentials.status}: ${credentials.body?.message ?? ''}`.trim());
      // Carrying on a transcript still recording: what it last heard to now is a gap.
      await publish('connected', stream.lastActivityAt ? { gap: { startedAt: stream.lastActivityAt, endedAt: new Date().toISOString() } } : {});
      sendLines(sessionId, publish);
    } catch (error) {
      await publish('failed', { reason: error.message }).catch(() => {});
    }
  });
  return Response.json({ metadata: stream.metadata ?? {} }, { status: 202 });
}

export async function pauseStream(request, context) {
  const body = await request.json().catch(() => ({}));
  halt(context.params.transcriptionSessionId);
  return Response.json({ metadata: body.metadata ?? {} }, { status: 202 });
}

export async function stopStream(request, context) {
  const sessionId = context.params.transcriptionSessionId;
  const body = await request.json().catch(() => ({}));
  halt(sessionId);
  later(async () => {
    // After a reload, the session says which transcript it has.
    if (!transcripts.has(sessionId)) {
      const session = await context.call('getTranscriptionSession', { params: { transcriptionSessionId: sessionId } });
      transcripts.set(sessionId, session.body?.transcriptId);
    }
    await publisher(context, sessionId)('ended', { at: new Date().toISOString() });
  });
  return Response.json({ metadata: body.metadata ?? {} }, { status: 202 });
}

/**
 * The credentials part, as a hosted service's checks it: only a signed-in
 * caller gets a credential. Any token will do here; a real one checks it
 * against its identity provider.
 */
export async function requestCredentials(request) {
  if (!/^Bearer \S+/.test(request.headers.get('authorization') ?? '')) {
    return Response.json({ code: 'UNAUTHORIZED', message: 'Sign in first: a credential spends the service account.' }, { status: 401 });
  }
  const { metadata, provider } = await request.json();
  return Response.json({ metadata, provider, protocol: 'websocket', url: 'wss://fake-secured.invalid/stream', expiresIn: 900 });
}

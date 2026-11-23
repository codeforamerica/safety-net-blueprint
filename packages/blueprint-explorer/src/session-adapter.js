/**
 * The bookkeeping every transcription session adapter's streaming part shares,
 * as routing handlers (communication-transcription-sessions-adapter-openapi.yaml):
 * answering startStream, pauseStream and stopStream at once and doing the work
 * after, the envelope of each event the adapter publishes, pausing and
 * stopping, and `ended`. What reaches a transcription service is the adapter's
 * own `start`:
 *
 *   // whisper.js, a module a routing file names as a handler
 *   import { sessionAdapter } from '@codeforamerica/blueprint-explorer/session-adapter';
 *   export const { startStream, pauseStream, stopStream } = sessionAdapter({
 *     async start({ stream, audio, publish, requestCredentials }) {
 *       // stream:   what startStream was given: transcriptionSessionId,
 *       //           transcriptId, provider, model, languages, lastActivityAt
 *       // audio:    frames({ encoding, sampleRateHertz, channelCount }), an
 *       //           async iterable of frames at the pace they were spoken;
 *       //           or stream(), a MediaStream
 *       // publish(event, data): one of the session's events, such as
 *       //           'connected', 'line_updated', 'line_finished',
 *       //           'disconnected' or 'failed'; transcriptId is added
 *       // requestCredentials({ audio, protocols }): the credentials part's answer
 *       return { async stop() {} };   // stop resolves once the last line is published
 *     },
 *   });
 *
 * Pausing stops the adapter, and resuming starts it again. After a stop, the
 * helper publishes `ended`.
 *
 * Audio comes from `audioFor(sessionId)`: in the explorer, what Try it chose
 * on the session's start or resume; in an app, its own microphone.
 */

/** The audio Try it chose for each session, shared between the explorer's scripts. */
const chosenAudio = () => {
  globalThis.BlueprintExplorer ??= {};
  globalThis.BlueprintExplorer.audioForSessions ??= new Map();
  return globalThis.BlueprintExplorer.audioForSessions;
};

/**
 * Hand a session's adapter the audio it hears when it next starts or
 * resumes. Try it calls this on Send.
 *
 * @param {string} sessionId
 * @param {object} audio - With frames(format), stream() and stop()
 */
export function audioForSession(sessionId, audio) {
  chosenAudio().set(sessionId, audio);
}

/** What Try it chose for a session, taken once; none, nothing is heard. */
function takeChosenAudio(sessionId) {
  const audio = chosenAudio().get(sessionId) ?? null;
  chosenAudio().delete(sessionId);
  return audio;
}

/** No audio: nothing is heard until it's stopped. */
export function silence() {
  let wake = null;
  let ended = false;
  let markEnded;
  const done = new Promise((resolve) => { markEnded = resolve; });
  return {
    ended: done,
    async *frames() {
      while (!ended) await new Promise((resolve) => { wake = resolve; });
    },
    async stream() { return new MediaStream(); },
    stop() { ended = true; wake?.(); markEnded(); },
  };
}

/** Tell whoever is watching about a call the adapter made: the explorer's activity log. */
const logged = (entry) => { try { globalThis.BlueprintExplorer?.logCall?.(entry); } catch { /* a log, nothing more */ } };

/**
 * Routing handlers for one transcription service's session adapter.
 *
 * @param {object} implementation
 * @param {(args: object) => Promise<{ stop: () => Promise<void> }>} implementation.start
 * @param {object} [options]
 * @param {(sessionId: string) => object|null} [options.audioFor] - The audio for a session; Try it's choice by default
 * @returns {{ startStream: Function, pauseStream: Function, stopStream: Function }}
 */
export function sessionAdapter({ start }, { audioFor = takeChosenAudio } = {}) {
  /** Each session's running adapter, and its transcript, for `ended` after a pause. */
  const running = new Map();
  const transcripts = new Map();

  const publisher = (context, sessionId, transcriptId) => async (event, data = {}) => {
    const answer = await context.publish(`transcription_session.${event}`, { transcriptId, ...data }, { subject: sessionId });
    logged({ ...answer, event: `transcription_session.${event}` });
    if (answer.status >= 400) throw new Error(`publishing ${event} answered ${answer.status}: ${answer.body?.message ?? ''}`.trim());
  };

  async function begin(stream, context) {
    const { transcriptionSessionId: sessionId, transcriptId } = stream;
    transcripts.set(sessionId, transcriptId);
    const publish = publisher(context, sessionId, transcriptId);
    const audio = audioFor(sessionId) ?? silence();
    const requestCredentials = async ({ audio: format, protocols }) => {
      const answer = await context.call('requestCredentials', {
        body: {
          metadata: { transcriptionSessionId: sessionId, transcriptId },
          provider: stream.provider,
          ...(stream.model ? { model: stream.model } : {}),
          ...(stream.languages ? { languages: stream.languages } : {}),
          audio: format,
          protocols,
        },
      });
      logged(answer);
      if (answer.status >= 400) throw new Error(`requestCredentials answered ${answer.status}: ${answer.body?.message ?? ''}`.trim());
      return answer.body;
    };
    try {
      const handle = await start({ stream, audio, publish, requestCredentials });
      running.set(sessionId, { handle, audio });
    } catch (error) {
      audio.stop();
      await publish('failed', { reason: error.message }).catch(() => {});
    }
  }

  /** Stop a session's adapter, if it's running, and its audio. */
  async function halt(sessionId) {
    const run = running.get(sessionId);
    running.delete(sessionId);
    if (!run) return;
    run.audio.stop();
    await run.handle.stop();
  }

  const accepted = (body) => Response.json({ metadata: body?.metadata ?? {} }, { status: 202 });
  const later = (work) => setTimeout(() => { work().catch((error) => console.warn(`The session adapter: ${error.message}`)); }, 0);

  return {
    async startStream(request, context) {
      const body = await request.json();
      later(() => begin(body, context));
      return accepted(body);
    },
    async pauseStream(request, context) {
      const body = await request.json().catch(() => ({}));
      later(() => halt(context.params.transcriptionSessionId));
      return accepted(body);
    },
    async stopStream(request, context) {
      const sessionId = context.params.transcriptionSessionId;
      const body = await request.json().catch(() => ({}));
      later(async () => {
        await halt(sessionId);
        // After a reload, the session says which transcript it has.
        const transcriptId = transcripts.get(sessionId)
          ?? (await context.call('getTranscriptionSession', { params: { transcriptionSessionId: sessionId } })).body?.transcriptId;
        await publisher(context, sessionId, transcriptId)('ended', { at: new Date().toISOString() });
      });
      return accepted(body);
    },
  };
}

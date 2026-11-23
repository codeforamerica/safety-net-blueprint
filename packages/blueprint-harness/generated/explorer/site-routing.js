// routing.yaml, and the modules it names, bundled by the explorer's build.
(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // packages/blueprint-explorer/examples/session-adapters/whisper.js
  var whisper_exports = {};
  __export(whisper_exports, {
    pauseStream: () => pauseStream,
    requestCredentials: () => requestCredentials,
    startStream: () => startStream,
    stopStream: () => stopStream
  });

  // packages/blueprint-explorer/src/session-adapter.js
  var chosenAudio = () => {
    globalThis.BlueprintExplorer ??= {};
    globalThis.BlueprintExplorer.audioForSessions ??= /* @__PURE__ */ new Map();
    return globalThis.BlueprintExplorer.audioForSessions;
  };
  function takeChosenAudio(sessionId) {
    const audio = chosenAudio().get(sessionId) ?? null;
    chosenAudio().delete(sessionId);
    return audio;
  }
  function silence() {
    let wake = null;
    let ended = false;
    let markEnded;
    const done = new Promise((resolve) => {
      markEnded = resolve;
    });
    return {
      ended: done,
      async *frames() {
        while (!ended) await new Promise((resolve) => {
          wake = resolve;
        });
      },
      async stream() {
        return new MediaStream();
      },
      stop() {
        ended = true;
        wake?.();
        markEnded();
      }
    };
  }
  var logged = (entry) => {
    try {
      globalThis.BlueprintExplorer?.logCall?.(entry);
    } catch {
    }
  };
  function sessionAdapter({ start }, { audioFor = takeChosenAudio } = {}) {
    const running = /* @__PURE__ */ new Map();
    const transcripts = /* @__PURE__ */ new Map();
    const publisher = (context, sessionId, transcriptId) => async (event, data = {}) => {
      const answer = await context.publish(`transcription_session.${event}`, { transcriptId, ...data }, { subject: sessionId });
      logged({ ...answer, event: `transcription_session.${event}` });
      if (answer.status >= 400) throw new Error(`publishing ${event} answered ${answer.status}: ${answer.body?.message ?? ""}`.trim());
    };
    async function begin(stream, context) {
      const { transcriptionSessionId: sessionId, transcriptId } = stream;
      transcripts.set(sessionId, transcriptId);
      const publish = publisher(context, sessionId, transcriptId);
      const audio = audioFor(sessionId) ?? silence();
      const requestCredentials2 = async ({ audio: format, protocols }) => {
        const answer = await context.call("requestCredentials", {
          body: {
            metadata: { transcriptionSessionId: sessionId, transcriptId },
            provider: stream.provider,
            ...stream.model ? { model: stream.model } : {},
            ...stream.languages ? { languages: stream.languages } : {},
            audio: format,
            protocols
          }
        });
        logged(answer);
        if (answer.status >= 400) throw new Error(`requestCredentials answered ${answer.status}: ${answer.body?.message ?? ""}`.trim());
        return answer.body;
      };
      try {
        const handle = await start({ stream, audio, publish, requestCredentials: requestCredentials2 });
        running.set(sessionId, { handle, audio });
      } catch (error) {
        audio.stop();
        await publish("failed", { reason: error.message }).catch(() => {
        });
      }
    }
    async function halt(sessionId) {
      const run = running.get(sessionId);
      running.delete(sessionId);
      if (!run) return;
      run.audio.stop();
      await run.handle.stop();
    }
    const accepted = (body) => Response.json({ metadata: body?.metadata ?? {} }, { status: 202 });
    const later = (work) => setTimeout(() => {
      work().catch((error) => console.warn(`The session adapter: ${error.message}`));
    }, 0);
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
          const transcriptId = transcripts.get(sessionId) ?? (await context.call("getTranscriptionSession", { params: { transcriptionSessionId: sessionId } })).body?.transcriptId;
          await publisher(context, sessionId, transcriptId)("ended", { at: (/* @__PURE__ */ new Date()).toISOString() });
        });
        return accepted(body);
      }
    };
  }

  // packages/blueprint-explorer/examples/session-adapters/whisper-model.js
  var LIBRARY = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2";
  var MODEL = "onnx-community/whisper-tiny.en_timestamped";
  var WHISPER_RATE = 16e3;
  var loading = null;
  function loadWhisper() {
    loading ??= (async () => {
      const library = LIBRARY;
      const { pipeline } = await import(library);
      const recognize = await pipeline("automatic-speech-recognition", MODEL, { dtype: "q8" });
      return async (samples) => {
        const result = await recognize(samples, { return_timestamps: "word" });
        return {
          text: String(result.text ?? "").trim(),
          words: (result.chunks ?? []).map((chunk) => ({
            word: String(chunk.text).trim(),
            startMs: Math.round((chunk.timestamp?.[0] ?? 0) * 1e3),
            endMs: Math.round((chunk.timestamp?.[1] ?? chunk.timestamp?.[0] ?? 0) * 1e3)
          })).filter((w) => w.word)
        };
      };
    })();
    loading.catch(() => {
      loading = null;
    });
    return loading;
  }

  // packages/blueprint-explorer/examples/session-adapters/whisper.js
  var FORMAT = { encoding: "linear16", sampleRateHertz: WHISPER_RATE, channelCount: 1 };
  var SILENCE = 0.01;
  var PAUSE_MS = 700;
  var IN_PROGRESS_EVERY_MS = 1500;
  var LONGEST_MS = 25e3;
  var NOTHING_SAID = /^\s*[[(][^\])]*[\])]\s*$/;
  var msOf = (samples) => Math.round(samples / WHISPER_RATE * 1e3);
  var samplesOf = (frame) => {
    const pcm = new Int16Array(frame instanceof ArrayBuffer ? frame : frame.buffer);
    const out = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i += 1) out[i] = pcm[i] / 32768;
    return out;
  };
  var silent = (samples) => {
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    return Math.sqrt(sum / Math.max(1, samples.length)) < SILENCE;
  };
  var { startStream, pauseStream, stopStream } = sessionAdapter({
    async start({ stream, audio, publish, requestCredentials: requestCredentials2 }) {
      await requestCredentials2({ audio: FORMAT, protocols: ["websocket"] });
      const transcribe = await loadWhisper();
      const speaker = "unknown";
      const began = Date.now();
      const at = (ms) => new Date(began + ms).toISOString();
      const run = began.toString(36);
      await publish("connected", stream.lastActivityAt ? { gap: { startedAt: stream.lastActivityAt, endedAt: new Date(began).toISOString() } } : {});
      let chunks = [];
      let length = 0;
      let startedAt = 0;
      let received = 0;
      let spoke = false;
      let quietMs = 0;
      let lastInProgress = 0;
      let count = 1;
      let stopped = false;
      let busy = false;
      let work = Promise.resolve();
      const stretch = () => {
        const samples = new Float32Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          samples.set(chunk, offset);
          offset += chunk.length;
        }
        return { samples, key: `${run}.l${count}`, from: startedAt };
      };
      const send = ({ samples, key, from }, finished) => {
        if (!finished) busy = true;
        work = work.then(async () => {
          try {
            const { text } = await transcribe(samples);
            if (!text || NOTHING_SAID.test(text)) return;
            if (finished) await publish("line_finished", { key, text, speaker, startedAt: at(from), endedAt: at(from + msOf(samples.length)) });
            else await publish("line_updated", { key, text, speaker, startedAt: at(from) });
          } catch (error) {
            console.warn(`Whisper in this page: ${error.message}`);
          } finally {
            if (!finished) busy = false;
          }
        });
      };
      const finish = () => {
        if (spoke && length) send(stretch(), true);
        chunks = [];
        length = 0;
        spoke = false;
        quietMs = 0;
        lastInProgress = 0;
        count += 1;
      };
      const hear = (frame) => {
        const samples = samplesOf(frame);
        const frameMs = msOf(samples.length);
        if (!length) startedAt = received;
        received += frameMs;
        chunks.push(samples);
        length += samples.length;
        if (silent(samples)) quietMs += frameMs;
        else {
          quietMs = 0;
          spoke = true;
        }
        if (!spoke) {
          chunks = [];
          length = 0;
          return;
        }
        const heardMs = msOf(length);
        if (quietMs >= PAUSE_MS || heardMs >= LONGEST_MS) finish();
        else if (!busy && heardMs - lastInProgress >= IN_PROGRESS_EVERY_MS) {
          lastInProgress = heardMs;
          send(stretch(), false);
        }
      };
      const listening = (async () => {
        for await (const frame of audio.frames(FORMAT)) {
          if (stopped) break;
          hear(frame);
        }
        finish();
      })();
      return {
        async stop() {
          stopped = true;
          await listening;
          await work;
        },
        /** Settles once the audio has run out and its last line is in. */
        done: listening.then(() => work)
      };
    }
  });
  async function requestCredentials(request) {
    const { metadata, provider } = await request.json();
    return Response.json({ metadata, provider, protocol: "websocket", url: "wss://whisper.invalid/in-this-page", expiresIn: 3600 });
  }

  // packages/blueprint-harness/explorer/routing.yaml
  globalThis.BlueprintExplorer ??= {};
  globalThis.BlueprintExplorer.routing = [
    ...globalThis.BlueprintExplorer.routing ?? [],
    { ...{ "api": "communication-transcription-sessions-adapter", "match": { "provider": "whisper" } }, handler: whisper_exports }
  ];
})();

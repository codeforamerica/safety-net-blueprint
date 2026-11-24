// routing.yaml, and the modules it names, bundled by the explorer's build.
(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // packages/blueprint-harness/explorer/adapters/whisper.js
  var whisper_exports = {};
  __export(whisper_exports, {
    pauseStream: () => pauseStream,
    startStream: () => startStream,
    stopStream: () => stopStream
  });

  // packages/blueprint-harness/explorer/adapters/whisper-model.js
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

  // packages/blueprint-harness/explorer/adapters/whisper.js
  var SILENCE = 0.01;
  var PAUSE_MS = 700;
  var IN_PROGRESS_EVERY_MS = 1500;
  var LONGEST_MS = 25e3;
  var NOTHING_SAID = /^\s*[[(][^\])]*[\])]\s*$/;
  var msOf = (samples) => Math.round(samples / WHISPER_RATE * 1e3);
  var silent = (samples) => {
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    return Math.sqrt(sum / Math.max(1, samples.length)) < SILENCE;
  };
  var HEARING = `registerProcessor('hearing', class extends AudioWorkletProcessor {
  process([input]) {
    if (input?.[0]?.length) this.port.postMessage(input[0].slice());
    return true;
  }
});`;
  async function listen(hear) {
    const microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const context = new AudioContext({ sampleRate: WHISPER_RATE });
    await context.audioWorklet.addModule(`data:text/javascript,${encodeURIComponent(HEARING)}`);
    const hearing = new AudioWorkletNode(context, "hearing");
    hearing.port.onmessage = ({ data }) => hear(data);
    context.createMediaStreamSource(microphone).connect(hearing);
    return () => {
      microphone.getTracks().forEach((track) => track.stop());
      return context.close().catch(() => {
      });
    };
  }
  async function transcribe(stream, publish) {
    const transcribeStretch = await loadWhisper();
    const speaker = "unknown";
    const began = Date.now();
    const at = (ms) => new Date(began + ms).toISOString();
    const run = began.toString(36);
    let chunks = [];
    let length = 0;
    let startedAt = 0;
    let received = 0;
    let spoke = false;
    let quietMs = 0;
    let lastInProgress = 0;
    let count = 1;
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
          const { text } = await transcribeStretch(samples);
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
    const hear = (samples) => {
      const heardMs = msOf(samples.length);
      if (!length) startedAt = received;
      received += heardMs;
      chunks.push(samples);
      length += samples.length;
      if (silent(samples)) quietMs += heardMs;
      else {
        quietMs = 0;
        spoke = true;
      }
      if (!spoke) {
        chunks = [];
        length = 0;
        return;
      }
      const stretchMs = msOf(length);
      if (quietMs >= PAUSE_MS || stretchMs >= LONGEST_MS) finish();
      else if (!busy && stretchMs - lastInProgress >= IN_PROGRESS_EVERY_MS) {
        lastInProgress = stretchMs;
        send(stretch(), false);
      }
    };
    const stopListening = await listen(hear);
    try {
      await publish("connected", stream.lastActivityAt ? { gap: { startedAt: stream.lastActivityAt, endedAt: new Date(began).toISOString() } } : {});
    } catch (error) {
      await stopListening();
      throw error;
    }
    return async () => {
      await stopListening();
      finish();
      await work;
    };
  }
  var running = /* @__PURE__ */ new Map();
  var transcripts = /* @__PURE__ */ new Map();
  var publisher = (context, sessionId) => async (event, data = {}) => {
    const answer = await context.publish(`transcription_session.${event}`, { transcriptId: transcripts.get(sessionId), ...data }, { subject: sessionId });
    if (answer.status >= 400) throw new Error(`publishing ${event} answered ${answer.status}: ${answer.body?.message ?? ""}`.trim());
  };
  var later = (work) => setTimeout(() => {
    work().catch((error) => console.warn(`Whisper in this page: ${error.message}`));
  }, 0);
  async function halt(sessionId) {
    const stop = running.get(sessionId);
    running.delete(sessionId);
    await stop?.();
  }
  async function startStream(request, context) {
    const stream = await request.json();
    const sessionId = stream.transcriptionSessionId;
    transcripts.set(sessionId, stream.transcriptId);
    const publish = publisher(context, sessionId);
    later(async () => {
      try {
        running.set(sessionId, await transcribe(stream, publish));
      } catch (error) {
        await publish("failed", { reason: error.message }).catch(() => {
        });
      }
    });
    return Response.json({ metadata: stream.metadata ?? {} }, { status: 202 });
  }
  async function pauseStream(request, context) {
    const body = await request.json().catch(() => ({}));
    later(() => halt(context.params.transcriptionSessionId));
    return Response.json({ metadata: body.metadata ?? {} }, { status: 202 });
  }
  async function stopStream(request, context) {
    const sessionId = context.params.transcriptionSessionId;
    const body = await request.json().catch(() => ({}));
    later(async () => {
      await halt(sessionId);
      if (!transcripts.has(sessionId)) {
        const session = await context.call("getTranscriptionSession", { params: { transcriptionSessionId: sessionId } });
        transcripts.set(sessionId, session.body?.transcriptId);
      }
      await publisher(context, sessionId)("ended", { at: (/* @__PURE__ */ new Date()).toISOString() });
    });
    return Response.json({ metadata: body.metadata ?? {} }, { status: 202 });
  }

  // packages/blueprint-harness/explorer/adapters/fake-secured.js
  var fake_secured_exports = {};
  __export(fake_secured_exports, {
    pauseStream: () => pauseStream2,
    requestCredentials: () => requestCredentials,
    startStream: () => startStream2,
    stopStream: () => stopStream2
  });
  var LINES = [
    { speaker: "staff", text: "Can you tell me who lives with you?" },
    { speaker: "client", text: "My sister and her two kids." },
    { speaker: "staff", text: "Does anyone in the household work?" },
    { speaker: "client", text: "I work at the grocery store, about thirty hours a week." }
  ];
  var EVERY_MS = 2e3;
  var running2 = /* @__PURE__ */ new Map();
  var transcripts2 = /* @__PURE__ */ new Map();
  var publisher2 = (context, sessionId) => async (event, data = {}) => {
    const answer = await context.publish(`transcription_session.${event}`, { transcriptId: transcripts2.get(sessionId), ...data }, { subject: sessionId });
    if (answer.status >= 400) throw new Error(`publishing ${event} answered ${answer.status}: ${answer.body?.message ?? ""}`.trim());
  };
  var later2 = (work) => setTimeout(() => {
    work().catch((error) => console.warn(`fake-secured: ${error.message}`));
  }, 0);
  function sendLines(sessionId, publish) {
    const run = Date.now().toString(36);
    let next = 0;
    const timer = setInterval(() => {
      if (next >= LINES.length) return;
      const { speaker, text } = LINES[next];
      const endedAt = (/* @__PURE__ */ new Date()).toISOString();
      const startedAt = new Date(Date.now() - EVERY_MS / 2).toISOString();
      next += 1;
      publish("line_finished", { key: `${run}.l${next}`, text, speaker, startedAt, endedAt }).catch((error) => console.warn(`fake-secured: ${error.message}`));
    }, EVERY_MS);
    running2.set(sessionId, () => clearInterval(timer));
  }
  function halt2(sessionId) {
    running2.get(sessionId)?.();
    running2.delete(sessionId);
  }
  async function startStream2(request, context) {
    const stream = await request.json();
    const sessionId = stream.transcriptionSessionId;
    transcripts2.set(sessionId, stream.transcriptId);
    const publish = publisher2(context, sessionId);
    later2(async () => {
      try {
        const credentials = await context.call("requestCredentials", {
          body: {
            metadata: { transcriptionSessionId: sessionId, transcriptId: stream.transcriptId },
            provider: stream.provider,
            ...stream.model ? { model: stream.model } : {},
            ...stream.languages ? { languages: stream.languages } : {},
            audio: { encoding: "linear16", sampleRateHertz: 16e3, channelCount: 1 },
            protocols: ["websocket"]
          }
        });
        if (credentials.status >= 400) throw new Error(`requestCredentials answered ${credentials.status}: ${credentials.body?.message ?? ""}`.trim());
        await publish("connected", stream.lastActivityAt ? { gap: { startedAt: stream.lastActivityAt, endedAt: (/* @__PURE__ */ new Date()).toISOString() } } : {});
        sendLines(sessionId, publish);
      } catch (error) {
        await publish("failed", { reason: error.message }).catch(() => {
        });
      }
    });
    return Response.json({ metadata: stream.metadata ?? {} }, { status: 202 });
  }
  async function pauseStream2(request, context) {
    const body = await request.json().catch(() => ({}));
    halt2(context.params.transcriptionSessionId);
    return Response.json({ metadata: body.metadata ?? {} }, { status: 202 });
  }
  async function stopStream2(request, context) {
    const sessionId = context.params.transcriptionSessionId;
    const body = await request.json().catch(() => ({}));
    halt2(sessionId);
    later2(async () => {
      if (!transcripts2.has(sessionId)) {
        const session = await context.call("getTranscriptionSession", { params: { transcriptionSessionId: sessionId } });
        transcripts2.set(sessionId, session.body?.transcriptId);
      }
      await publisher2(context, sessionId)("ended", { at: (/* @__PURE__ */ new Date()).toISOString() });
    });
    return Response.json({ metadata: body.metadata ?? {} }, { status: 202 });
  }
  async function requestCredentials(request) {
    if (!/^Bearer \S+/.test(request.headers.get("authorization") ?? "")) {
      return Response.json({ code: "UNAUTHORIZED", message: "Sign in first: a credential spends the service account." }, { status: 401 });
    }
    const { metadata, provider } = await request.json();
    return Response.json({ metadata, provider, protocol: "websocket", url: "wss://fake-secured.invalid/stream", expiresIn: 900 });
  }

  // packages/blueprint-harness/explorer/routing.yaml
  globalThis.BlueprintExplorer ??= {};
  globalThis.BlueprintExplorer.routing = [
    ...globalThis.BlueprintExplorer.routing ?? [],
    { ...{ "api": "communication-transcription-sessions-adapter", "match": { "provider": "whisper" } }, handler: whisper_exports, [/* @__PURE__ */ Symbol.for("blueprint-explorer.handler-file")]: "./adapters/whisper.js" },
    { ...{ "api": "communication-transcription-sessions-adapter", "match": { "provider": "fake-secured" } }, handler: fake_secured_exports, [/* @__PURE__ */ Symbol.for("blueprint-explorer.handler-file")]: "./adapters/fake-secured.js" }
  ];
})();

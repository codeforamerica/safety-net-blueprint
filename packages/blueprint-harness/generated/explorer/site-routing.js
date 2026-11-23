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
    requestCredentials: () => requestCredentials,
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
  var FORMAT = { encoding: "linear16", sampleRateHertz: WHISPER_RATE, channelCount: 1 };
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
        const credentials = await context.call("requestCredentials", {
          body: {
            metadata: { transcriptionSessionId: sessionId, transcriptId: stream.transcriptId },
            provider: stream.provider,
            ...stream.model ? { model: stream.model } : {},
            ...stream.languages ? { languages: stream.languages } : {},
            audio: FORMAT,
            protocols: ["websocket"]
          }
        });
        if (credentials.status >= 400) throw new Error(`requestCredentials answered ${credentials.status}: ${credentials.body?.message ?? ""}`.trim());
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

/**
 * What Try it gives an adapter that asks for the microphone.
 *
 * An adapter hears the way it would in an app, by asking the browser for the
 * microphone with getUserMedia. Try it answers that request itself: it asks
 * the reader what the adapter should hear — the microphone, a recording, or
 * typed lines spoken (adapter-panel.js, audioPrompt) — and gives a stream of
 * it, played aloud too, so the reader hears what the adapter hears. Only an
 * adapter that asks is asked about, so one that never listens never shows the
 * question. Test tools give a page a fake microphone the same way.
 */

/**
 * Answer the page's requests for the microphone by asking the reader.
 *
 * @param {() => Promise<{ microphone: true } | { recording: Blob } | null>} ask -
 *   What to give: the microphone itself, a recording, or null for nothing,
 *   which refuses the request as a browser refuses one the user declined
 */
export function answerMicrophone(ask) {
  const devices = navigator.mediaDevices;
  if (!devices?.getUserMedia) return;
  const browsers = devices.getUserMedia.bind(devices);
  devices.getUserMedia = async (constraints) => {
    if (!constraints?.audio || constraints.video) return browsers(constraints);
    const given = await ask();
    if (!given) throw new DOMException('No audio was given', 'NotAllowedError');
    if (given.microphone) return browsers(constraints);
    return playing(given.recording);
  };
}

/** A stream playing a recording, aloud as well. */
async function playing(recording) {
  const speakers = new AudioContext();
  const source = speakers.createBufferSource();
  source.buffer = await speakers.decodeAudioData(await recording.arrayBuffer());
  const given = speakers.createMediaStreamDestination();
  source.connect(speakers.destination);
  source.connect(given);
  // Stopping the stream, as an adapter does when it's done, stops the playing.
  for (const track of given.stream.getTracks()) {
    const stop = track.stop.bind(track);
    track.stop = () => { stop(); source.onended = null; speakers.close().catch(() => {}); };
  }
  source.onended = () => speakers.close().catch(() => {});
  source.start();
  return given.stream;
}

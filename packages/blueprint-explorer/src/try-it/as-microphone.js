/**
 * Audio Try it chose for a transcription session, given as the microphone.
 *
 * A session's adapter hears the way it would in an app, by asking the browser
 * for the microphone with getUserMedia. When the reader chose a recording, or
 * typed lines spoken first (kokoro.js), the next such request gets a stream
 * playing it instead, played aloud too so the reader hears what the adapter
 * hears. Choosing the microphone changes nothing. Test tools give a page a
 * fake microphone the same way.
 */

/** The request getUserMedia answers before Try it stepped in, if it has. */
let waiting = null;

/** Answer requests for the microphone as the browser does again. */
function release() {
  if (!waiting) return;
  waiting = null;
  // The browser's own is on the prototype; Try it's shadowed it on the object.
  delete navigator.mediaDevices.getUserMedia;
}

/**
 * Give a recording as the microphone, to the next request for one only.
 *
 * @param {File|Blob} file
 */
export function playAsMicrophone(file) {
  release();
  const devices = navigator.mediaDevices;
  const browsers = devices.getUserMedia.bind(devices);
  waiting = file;
  devices.getUserMedia = async (constraints) => {
    if (!constraints?.audio || constraints.video || !waiting) return browsers(constraints);
    const recording = waiting;
    release();
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
  };
}

/** The microphone itself, for the next request: what was chosen before is dropped. */
export function useMicrophone() {
  release();
}

/**
 * A client adapter that plays back a recorded session instead of streaming
 * to a service, for demos and tests: no service, no credential, no audio.
 * It takes whatever connection get-connection answered and ignores it.
 *
 * A recording is a list of what an adapter reports, each at a time in seconds
 * from the start of the recording:
 *
 *   { events: [
 *       { at: 1.2, type: 'update', key: 'l1', text: 'Who lives', speakerLabel: 'spk_0', start: 0.8 },
 *       { at: 2.0, type: 'add', key: 'l1', text: 'Who lives with you?', speakerLabel: 'spk_0', start: 0.8, end: 1.9 },
 *       { at: 6.0, type: 'drop' },
 *   ] }
 *
 * Playback carries on where it stopped: a connection opened after a pause or
 * a drop picks up the recording at the next event, so a line isn't heard
 * twice. Times in a report are from when that connection opened, as a
 * service gives them.
 */

/**
 * @param {{ events: object[] }} recording
 * @param {object} [options]
 * @param {number} [options.speed] - 2 plays twice as fast.
 * @param {Function} [options.sleep] - waits a number of milliseconds.
 */
export function createReplayAdapter(recording, {
  speed = 1,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const events = [...(recording?.events ?? [])].sort((a, b) => a.at - b.at);
  let next = 0;
  let clock = 0; // where in the recording playback has got to, in seconds

  return {
    async open({ report }) {
      const base = clock;
      let stopped = false;
      let stop;
      const stopping = new Promise((resolve) => { stop = resolve; });
      const playing = (async () => {
        while (!stopped && next < events.length) {
          const event = events[next];
          const wait = Math.max(0, event.at - clock);
          // Finishing doesn't wait for the next event to come due.
          if (wait > 0) await Promise.race([sleep((wait * 1000) / speed), stopping]);
          if (stopped) return;
          clock = event.at;
          next += 1;
          const { at, type, ...line } = event;
          const shifted = { ...line };
          if (line.start !== undefined) shifted.start = Math.max(0, line.start - base);
          if (line.end !== undefined) shifted.end = Math.max(0, line.end - base);
          if (type === 'update') report.update(shifted);
          else if (type === 'add') report.add(shifted);
          else if (type === 'drop') { stopped = true; report.dropped(); return; }
        }
      })();
      return {
        async finish() {
          stopped = true;
          stop();
          await playing;
        },
      };
    },
  };
}

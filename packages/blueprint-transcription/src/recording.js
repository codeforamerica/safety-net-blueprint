/**
 * Playing back a recording, for the fakes: the fake client adapter and the
 * fake relay play the same recordings the same way.
 *
 * A recording is a list of what a service reports, each at a time in seconds
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
 * twice. A line's `start` and `end` are given from when that connection
 * opened, as a service gives them.
 */

/**
 * @param {{ events: object[] }} recording
 * @param {object} [options]
 * @param {number} [options.speed] - 2 plays twice as fast.
 * @param {Function} [options.sleep] - waits a number of milliseconds.
 */
export function createPlayback(recording, {
  speed = 1,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const events = [...(recording?.events ?? [])].sort((a, b) => a.at - b.at);
  let next = 0;
  let clock = 0; // where in the recording playback has got to, in seconds

  return {
    /**
     * Play from where playback stopped, calling `onEvent(type, line)` for
     * each event as it comes due. A drop ends this playing.
     *
     * @returns {{ stop: () => Promise<void>, done: Promise<void> }}
     */
    play(onEvent) {
      const base = clock;
      let stopped = false;
      let release;
      const stopping = new Promise((resolve) => { release = resolve; });
      const done = (async () => {
        while (!stopped && next < events.length) {
          const event = events[next];
          const wait = Math.max(0, event.at - clock);
          // Stopping doesn't wait for the next event to come due.
          if (wait > 0) await Promise.race([sleep((wait * 1000) / speed), stopping]);
          if (stopped) return;
          clock = event.at;
          next += 1;
          const { at, type, ...line } = event;
          if (line.start !== undefined) line.start = Math.max(0, line.start - base);
          if (line.end !== undefined) line.end = Math.max(0, line.end - base);
          onEvent(type, line);
          if (type === 'drop') return;
        }
      })();
      return {
        done,
        stop() {
          stopped = true;
          release();
          return done;
        },
      };
    },
  };
}

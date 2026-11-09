/**
 * A fake client adapter, in the testing sense: a working adapter with no
 * transcription service behind it. It plays back a recording instead of
 * streaming, for demos and tests: no service, no credential, no audio. It
 * takes whatever connection get-connection answered and ignores it.
 *
 * The recording's format is in src/recording.js; the fake relay plays the
 * same recordings.
 */

import { createPlayback } from '../recording.js';

/**
 * @param {{ events: object[] }} recording
 * @param {object} [options]
 * @param {number} [options.speed] - 2 plays twice as fast.
 * @param {Function} [options.sleep] - waits a number of milliseconds.
 */
export function createFakeAdapter(recording, options = {}) {
  const playback = createPlayback(recording, options);
  return {
    async open({ report }) {
      const playing = playback.play((type, line) => {
        if (type === 'update') report.update(line);
        else if (type === 'add') report.add(line);
        else if (type === 'drop') report.dropped();
      });
      return { finish: () => playing.stop() };
    },
  };
}

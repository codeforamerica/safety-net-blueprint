/**
 * Turn a demo script into a recording the fakes can play: each line becomes
 * a line in progress that grows a word at a time, then the finished line,
 * with the worker as `spk_0` and the applicant as `spk_1`. The format is the
 * transcription tools' demo scripts': lines starting `**Worker.**` or
 * `**Applicant.**`.
 */

const LINE = /^\*\*(Worker|Applicant)\.\*\* (.+)$/gm;

/**
 * @param {string} script
 * @param {object} [options]
 * @param {number} [options.secondsPerWord]
 * @param {number} [options.pause] - seconds between lines
 * @returns {{ events: object[] }}
 */
export function recordingFromScript(script, { secondsPerWord = 0.32, pause = 0.8 } = {}) {
  const events = [];
  let at = 0.5;
  let n = 0;
  for (const [, role, text] of script.matchAll(LINE)) {
    n += 1;
    const key = `line-${n}`;
    const speakerLabel = role === 'Worker' ? 'spk_0' : 'spk_1';
    const words = text.split(/\s+/);
    const start = at;
    words.forEach((_, i) => {
      // A service revises a line every few words, not every word.
      if (i % 3 === 2 && i < words.length - 1) {
        events.push({ at: start + (i + 1) * secondsPerWord, type: 'update', key, text: words.slice(0, i + 1).join(' '), speakerLabel, start });
      }
    });
    const end = start + words.length * secondsPerWord;
    events.push({ at: end + 0.2, type: 'add', key, text, speakerLabel, start, end, confidence: 0.94, language: 'en-US' });
    at = end + pause;
  }
  return { events };
}

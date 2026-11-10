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
 * @param {string[]} [options.beats] - a scenario's beats (scenarios.js): each
 *   `say` takes the next line, and `drop` drops the connection there; every
 *   line when not given
 * @param {number} [options.secondsPerWord]
 * @param {number} [options.pause] - seconds between lines
 * @returns {{ events: object[] }}
 */
export function recordingFromScript(script, { beats, secondsPerWord = 0.32, pause = 0.8 } = {}) {
  const lines = [...script.matchAll(LINE)].map(([, role, text]) => ({ role, text }));
  const plan = beats ?? lines.map(() => 'say');
  const events = [];
  let at = 0.5;
  let n = 0;
  for (const beat of plan) {
    if (beat === 'drop') {
      events.push({ at, type: 'drop' });
      at += pause;
      continue;
    }
    if (beat !== 'say' || n >= lines.length) continue;
    const { role, text } = lines[n];
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
  // Nothing happens at the end but a wait, which is where a scenario's last
  // beats run (demo.js); the fakes pass over an event they don't know.
  events.push({ at, type: 'quiet' });
  return { events };
}

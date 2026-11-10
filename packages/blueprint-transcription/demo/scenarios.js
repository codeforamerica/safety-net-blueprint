/**
 * The demo's scenarios: each a short interview with what happens during it,
 * fixed, so it plays the same way every time, a step at a time or all at
 * once. A scenario's beats run in order:
 *
 * - `say`: the next line of the interview is heard and saved;
 * - `pause`, `resume`, `stop`: the worker goes off the record, back on, or
 *   finishes;
 * - `drop`: the connection to the service drops, and the software
 *   reconnects;
 * - `pause-elsewhere`: someone else pauses the transcript on the server.
 *
 * `via` is how the browser reaches the service: straight to a vendor
 * (`vendor`, the fake adapter) or through a relay (`relay`, the fake relay in
 * the worker).
 */

export const SCENARIOS = [
  {
    id: 'vendor',
    title: 'An interview, straight to a vendor',
    summary: 'The browser streams straight to a transcription service. Each finished sentence is saved to the transcript on the server.',
    via: 'vendor',
    beats: ['say', 'say', 'say', 'stop'],
  },
  {
    id: 'relay',
    title: 'An interview, through a relay',
    summary: 'The same interview, for a service a browser can\'t reach: the browser streams to a relay the state runs, which speaks the relay contract.',
    via: 'relay',
    beats: ['say', 'say', 'say', 'stop'],
  },
  {
    id: 'off-the-record',
    title: 'Off the record and back',
    summary: 'The worker goes off the record: the connection closes, so no audio leaves the browser, and the transcript records the pause. Back on the record, a new connection carries on.',
    via: 'vendor',
    beats: ['say', 'pause', 'resume', 'say', 'stop'],
  },
  {
    id: 'drop',
    title: 'The connection drops',
    summary: 'The connection to the service drops. The browser asks the server for a fresh pass, reconnects, and the transcript records the stretch that was lost.',
    via: 'vendor',
    beats: ['say', 'drop', 'say', 'stop'],
  },
  {
    id: 'pause-elsewhere',
    title: 'Someone else pauses the transcript',
    summary: 'A supervisor pauses the transcript on the server. The session in the browser follows it, so the browser stops sending audio, without the worker doing anything.',
    via: 'vendor',
    beats: ['say', 'pause-elsewhere', 'resume', 'say', 'stop'],
  },
];

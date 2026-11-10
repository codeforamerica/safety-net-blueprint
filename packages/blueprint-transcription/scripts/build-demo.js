#!/usr/bin/env node
/**
 * Build the demo page as one file that opens from disk: demo/index.html with
 * the page's script bundled into it, and the worker's — the state's side —
 * bundled into that as text, which the page starts from a blob. Both carry
 * the package's code, the mock, and the harness's contracts; the page also
 * carries the SDK generated from them (npm run sdk). Written to demo/dist/,
 * which isn't committed.
 *
 * Usage: npm run build:demo -w packages/blueprint-transcription
 */

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const demo = join(root, 'demo');
const repo = join(root, '..', '..');

/**
 * What each step uses, as a contract names it — an SDK function, an
 * operation, a state machine's action, an event, a relay message — and the
 * line that declares it, linked on GitHub at the branch being built. The SDK
 * is generated from the contracts, so an SDK function links to the action or
 * operation it's generated from. A pattern that stops matching fails the
 * build, so a link never points at the wrong line.
 */
const DIR = 'packages/blueprint-core/base-contracts/domains';
const SESSIONS = `${DIR}/communication/communication-transcription-sessions-state-machine.yaml`;
const TRANSCRIPTS = `${DIR}/communication/communication-transcripts-state-machine.yaml`;
const TRANSCRIPTS_API = `${DIR}/communication/communication-transcripts-openapi.yaml`;
const ADAPTER = `${DIR}/communication/communication-transcripts-adapter-openapi.yaml`;
const RELAY = `${DIR}/communication/communication-transcripts-relay-asyncapi.yaml`;
const EVENTS = `${DIR}/platform/platform-events-openapi.yaml`;
const sdk = (fn, action) => [`${fn}()`, `SDK function, from the session's ${action} action`, SESSIONS, new RegExp(`- id: ${action}\\n`)];
const relayMessage = (name) => [name, 'relay message', RELAY, new RegExp(`^    ${name}:$`, 'm')];
const DEFINITIONS = {
  sdkGetConnection: sdk('getConnectionTranscriptionSession', 'get-connection'),
  sdkRenew: sdk('renewConnectionTranscriptionSession', 'renew-connection'),
  sdkConnect: sdk('connectTranscriptionSession', 'connect'),
  sdkUpdateLine: sdk('updateLineTranscriptionSession', 'update-line'),
  sdkAddLine: sdk('addLineTranscriptionSession', 'add-line'),
  sdkPause: sdk('pauseTranscriptionSession', 'pause'),
  sdkResume: sdk('resumeTranscriptionSession', 'resume'),
  sdkClose: sdk('closeTranscriptionSession', 'close'),
  streamEvents: ['streamEvents', 'operation', EVENTS, /operationId: streamEvents/],
  createTranscript: ['createTranscript', 'operation', TRANSCRIPTS_API, /operationId: createTranscript/],
  addTranscriptEntry: ['addTranscriptEntry', 'operation', TRANSCRIPTS_API, /operationId: addTranscriptEntry/],
  transcriptGetConnection: ['getConnectionTranscript', 'the transcript\'s get-connection action', TRANSCRIPTS, /- id: get-connection\n/],
  transcriptPause: ['pauseTranscript', 'the transcript\'s pause action', TRANSCRIPTS, /- id: pause\n/],
  transcriptResume: ['resumeTranscript', 'the transcript\'s resume action', TRANSCRIPTS, /- id: resume\n/],
  transcriptClose: ['closeTranscript', 'the transcript\'s close action', TRANSCRIPTS, /- id: close\n/],
  issueConnection: ['issueTranscriptConnection', 'the adapter\'s operation, which the state implements', ADAPTER, /operationId: issueTranscriptConnection/],
  eventPaused: ['communication.transcript.paused', 'event', TRANSCRIPTS, /- id: paused\n\s+description: The conversation went off/],
  eventResumed: ['communication.transcript.resumed', 'event', TRANSCRIPTS, /- id: resumed\n/],
  eventClosed: ['communication.transcript.closed', 'event', TRANSCRIPTS, /- id: closed\n\s+description: The transcript has ended/],
  sessionFollowsPaused: ['on communication.transcript.paused', 'the session follows it', SESSIONS, /- type: communication\.transcript\.paused/],
  sessionFollowsClosed: ['on communication.transcript.closed', 'the session follows it', SESSIONS, /- type: communication\.transcript\.closed/],
  relayChannel: ['audio', 'relay channel: one WebSocket, binary audio and JSON messages', RELAY, /^  audio:$/m],
  relayStart: relayMessage('start'),
  relayAudio: relayMessage('audio'),
  relayStarted: relayMessage('started'),
  relayKeepalive: relayMessage('keepalive'),
  relayFinalize: relayMessage('finalize'),
  relayEnd: relayMessage('end'),
  relayResult: relayMessage('result'),
  relayEnded: relayMessage('ended'),
  relayError: relayMessage('error'),
};
const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const REFS = Object.fromEntries(Object.entries(DEFINITIONS).map(([key, [name, kind, file, pattern]]) => {
  const text = readFileSync(join(repo, file), 'utf8');
  const match = pattern.exec(text);
  if (!match) throw new Error(`build-demo: ${pattern} no longer matches ${file}, so its link would be wrong`);
  const line = text.slice(0, match.index).split('\n').length;
  return [key, { name, kind, file: file.split('/').pop(), href: `https://github.com/codeforamerica/safety-net-blueprint/blob/${branch}/${file}#L${line}` }];
}));

execFileSync(process.execPath, [join(root, 'scripts', 'generate-sdk.js')], { stdio: 'inherit' });

const common = {
  bundle: true,
  platform: 'browser',
  format: 'iife',
  minify: true,
  write: false,
  loader: { '.md': 'text' },
  logLevel: 'error',
};

const worker = await build({ ...common, entryPoints: [join(demo, 'server.worker.js')] });
const page = await build({
  ...common,
  entryPoints: [join(demo, 'demo.js')],
  define: { WORKER_SOURCE: JSON.stringify(worker.outputFiles[0].text), REFS: JSON.stringify(REFS) },
});

// `</script` inside the bundle would end the tag early.
const script = `<script>${page.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`;
const html = readFileSync(join(demo, 'index.html'), 'utf8').replace('<!-- demo.js -->', () => script);
mkdirSync(join(demo, 'dist'), { recursive: true });
writeFileSync(join(demo, 'dist', 'index.html'), html);
console.log(`Built demo/dist/index.html (${Math.round(html.length / 1024)} KB)`);

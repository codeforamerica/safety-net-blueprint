#!/usr/bin/env node
/**
 * Build the demo page as one file that opens from disk: demo/index.html with
 * the page's script bundled into it — the package's code, the mock client and
 * mock server, the harness's contracts, and the SDK generated from them (npm
 * run sdk). Written to demo/dist/, which isn't committed.
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
 * The calls each step makes, as the contracts name them — a client function,
 * an operation, a state machine's action, an event, a relay message — with
 * the lines that declare each, for the page to show on hover, and a link to
 * them on GitHub at the branch being built. A client function is the
 * generated SDK's, named for the operation or action it's generated from. A
 * pattern that stops matching fails the build, so nothing shows the wrong
 * lines.
 */
const DIR = 'packages/blueprint-core/base-contracts/domains';
const SESSIONS = `${DIR}/communication/communication-transcription-sessions-state-machine.yaml`;
const TRANSCRIPTS = `${DIR}/communication/communication-transcripts-state-machine.yaml`;
const SESSIONS_API = `${DIR}/communication/communication-transcription-sessions-openapi.yaml`;
const TRANSCRIPTS_API = `${DIR}/communication/communication-transcripts-openapi.yaml`;
const ADAPTER = `${DIR}/communication/communication-transcripts-audio-adapter-openapi.yaml`;
const RELAY = `${DIR}/communication/communication-transcripts-relay-asyncapi.yaml`;
const EVENTS = `${DIR}/platform/platform-events-openapi.yaml`;
const sessionAction = (fn, action) => [`${fn}()`, `client function, for the session's ${action} action`, SESSIONS, new RegExp(`- id: ${action}\\n`)];
const transcriptAction = (fn, action) => [`${fn}()`, `client function, for the transcript's ${action} action`, TRANSCRIPTS, new RegExp(`- id: ${action}\\n`)];
const operation = (fn, file, kind = 'client function, for the operation') => [`${fn}()`, kind, file, new RegExp(`operationId: ${fn}\\n`)];
const relayMessage = (name) => [name, 'relay message', RELAY, new RegExp(`^    ${name}:$`, 'm')];
const DEFINITIONS = {
  createTranscriptionSession: operation('createTranscriptionSession', SESSIONS_API),
  getTranscriptionSession: operation('getTranscriptionSession', SESSIONS_API),
  getConnectionTranscriptionSession: sessionAction('getConnectionTranscriptionSession', 'get-connection'),
  renewConnectionTranscriptionSession: sessionAction('renewConnectionTranscriptionSession', 'renew-connection'),
  connectTranscriptionSession: sessionAction('connectTranscriptionSession', 'connect'),
  updateLineTranscriptionSession: sessionAction('updateLineTranscriptionSession', 'update-line'),
  addLineTranscriptionSession: sessionAction('addLineTranscriptionSession', 'add-line'),
  disconnectTranscriptionSession: sessionAction('disconnectTranscriptionSession', 'disconnect'),
  pauseTranscriptionSession: sessionAction('pauseTranscriptionSession', 'pause'),
  resumeTranscriptionSession: sessionAction('resumeTranscriptionSession', 'resume'),
  stopTranscriptionSession: sessionAction('stopTranscriptionSession', 'stop'),
  closeTranscriptionSession: sessionAction('closeTranscriptionSession', 'close'),
  streamEvents: operation('streamEvents', EVENTS),
  createTranscript: operation('createTranscript', TRANSCRIPTS_API),
  addTranscriptEntry: operation('addTranscriptEntry', TRANSCRIPTS_API),
  getConnectionTranscript: transcriptAction('getConnectionTranscript', 'get-connection'),
  pauseTranscript: transcriptAction('pauseTranscript', 'pause'),
  resumeTranscript: transcriptAction('resumeTranscript', 'resume'),
  closeTranscript: transcriptAction('closeTranscript', 'close'),
  issueTranscriptConnection: operation('issueTranscriptConnection', ADAPTER, 'the adapter\'s operation, which the state implements and the transcript calls'),
  getTranscriptConnectionKeys: operation('getTranscriptConnectionKeys', ADAPTER, 'the adapter\'s key set, which a relay checks tokens with'),
  'communication.transcript.paused': ['communication.transcript.paused', 'event, sent by the transcript', TRANSCRIPTS, /- id: paused\n\s+description: The conversation went off/],
  'communication.transcript.resumed': ['communication.transcript.resumed', 'event, sent by the transcript', TRANSCRIPTS, /- id: resumed\n/],
  'communication.transcript.closed': ['communication.transcript.closed', 'event, sent by the transcript', TRANSCRIPTS, /- id: closed\n\s+description: The transcript has ended/],
  'on communication.transcript.paused': ['the session follows it', 'the session\'s reaction to the event', SESSIONS, /- type: communication\.transcript\.paused/],
  'on communication.transcript.closed': ['the session follows it', 'the session\'s reaction to the event', SESSIONS, /- type: communication\.transcript\.closed/],
  relayChannel: ['audio', 'relay channel: one WebSocket, binary audio and JSON messages', RELAY, /^  audio:$/m],
  ...Object.fromEntries(['start', 'started', 'audio', 'keepalive', 'finalize', 'end', 'result', 'ended', 'error']
    .map((name) => [`relay.${name}`, relayMessage(name)])),
};

/**
 * The lines that declare it: from the match — or, for an operationId, from
 * its method — through everything indented under it, at most 40 lines.
 */
function excerpt(lines, at) {
  let first = at;
  if (/^\s*operationId:/.test(lines[at])) while (first > 0 && !/^\s{4}(get|put|post|patch|delete):\s*$/.test(lines[first])) first -= 1;
  const indent = lines[first].search(/\S/);
  let last = first;
  while (last + 1 < lines.length && (lines[last + 1].trim() === '' || lines[last + 1].search(/\S/) > indent)) last += 1;
  while (last > first && lines[last].trim() === '') last -= 1;
  const block = lines.slice(first, Math.min(last, first + 39) + 1).map((line) => line.slice(indent));
  return { line: first + 1, yaml: block.join('\n') + (last > first + 39 ? '\n…' : '') };
}

const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const REFS = Object.fromEntries(Object.entries(DEFINITIONS).map(([key, [name, kind, file, pattern]]) => {
  const text = readFileSync(join(repo, file), 'utf8');
  const match = pattern.exec(text);
  if (!match) throw new Error(`build-demo: ${pattern} no longer matches ${file}, so its declaration would be wrong`);
  const { line, yaml } = excerpt(text.split('\n'), text.slice(0, match.index).split('\n').length - 1);
  return [key, { name, kind, yaml, file: file.split('/').pop(), href: `https://github.com/codeforamerica/safety-net-blueprint/blob/${branch}/${file}#L${line}` }];
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

const page = await build({
  ...common,
  entryPoints: [join(demo, 'demo.js')],
  define: { REFS: JSON.stringify(REFS) },
});

// `</script` inside the bundle would end the tag early.
const script = `<script>${page.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`;
const html = readFileSync(join(demo, 'index.html'), 'utf8').replace('<!-- demo.js -->', () => script);
mkdirSync(join(demo, 'dist'), { recursive: true });
writeFileSync(join(demo, 'dist', 'index.html'), html);
console.log(`Built demo/dist/index.html (${Math.round(html.length / 1024)} KB)`);

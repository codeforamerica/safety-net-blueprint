# @codeforamerica/blueprint-transcription

> Reference transcription software for the Blueprint's transcription session contract

> **Pre-release:** This package is at `0.x`. Until `1.0.0`, minor versions may include breaking changes. Pin your version if stability matters.

## Installation

```bash
npm install @codeforamerica/blueprint-transcription
```

## What it does

Live transcription in the Blueprint streams audio from the browser straight to
a transcription service, and keeps only the finished text. The contracts
define every part of that — the transcription session in the page, the
transcript on the server, the adapter that issues a short-lived credential —
and this package implements the parts that aren't contracts. How the parts fit is in
[`docs/architecture/cross-cutting/browser-vendor-stream.md`](../../docs/architecture/cross-cutting/browser-vendor-stream.md).

It has two entry points, one for each place it runs:

| Entry point | Runs | What it has |
|---|---|---|
| `./client` | In the page | The driver, which is the only part that talks to the transcription session, and the client adapters it plugs in: one per transcription service, and a replay adapter |
| `./server` | Beside the state's server | The transcripts adapter, which holds a service's secret and issues the connection the page streams with, and an issuer for Amazon Transcribe |

Never import `./server` into a page: it's where secrets are used.

The session itself is a contract, not code here. The blueprint's mock runs it
in the page, and routing keeps it there while the transcript goes to the
server; see the mock server's guide.

## The client

```js
import { createTranscriptionClient, createReplayAdapter } from '@codeforamerica/blueprint-transcription/client';

const client = createTranscriptionClient({
  fetch: mock.fetch,                      // the in-page mock's, which routing forwards
  headers: { 'x-caller-id': staffId },
  audio: { encoding: 'linear16', sampleRateHertz: 16000, channelCount: 1 },
  adapters: { default: createReplayAdapter(recording) },
  speakerFor: (label) => (label === 'spk_0' ? 'staff' : 'client'),
});

const session = await client.start({ profileId, model: 'standard', client: 'my-app/1.0.0', startedAt: new Date().toISOString() });
await session.connect(audio);             // whatever the page captured, passed to the adapter
await session.pause();                    // off the record: the connection closes
await session.resume();
await session.stop();                     // the last text comes in, and the transcript closes
```

The driver asks the session how to stream, picks the adapter for the service
the server answered with, and turns everything the adapter reports into the
session's actions: lines in progress, finished lines, a dropped connection. A
drop is reconnected, and the stretch it lost is recorded on the transcript as
a gap; after `retries` failed attempts the session fails, and the transcript
stays open for a new session to carry on under.

### Writing a client adapter

An adapter speaks one service's protocol and holds no session logic:

```js
const adapter = {
  async open({ connection, audio, report }) {
    // Connect with what get-connection answered: connection.url, and
    // connection.accessToken where the service takes one. Stream `audio`.
    // Report as text comes back, with times in seconds from opening:
    //   report.update({ key, text, speakerLabel, start })
    //   report.add({ key, text, speakerLabel, start, end, confidence })
    //   report.dropped()
    return {
      async finish() { /* send the end of the audio; resolve once the last text is in */ },
    };
  },
};
```

`key` ties a line in progress to its finished line: the service's own result
id where it has one.

### The replay adapter

Plays back a recording instead of streaming, for demos and tests: no service,
no credential, no audio. A recording lists what an adapter would report, each
at a time in seconds:

```json
{ "events": [
  { "at": 1.0, "type": "update", "key": "l1", "text": "Who lives", "speakerLabel": "spk_0", "start": 0.5 },
  { "at": 2.0, "type": "add", "key": "l1", "text": "Who lives with you?", "speakerLabel": "spk_0", "start": 0.5, "end": 1.8 },
  { "at": 6.0, "type": "drop" }
] }
```

After a pause or a drop, playback carries on from where it stopped.

## The server

```js
import { createTranscriptsAdapter, transcribeIssuer } from '@codeforamerica/blueprint-transcription/server';

const adapter = createTranscriptsAdapter({
  issuers: {
    'aws-transcribe': transcribeIssuer({ region: 'us-east-1', settings: { 'show-speaker-label': 'true' } }),
  },
});

// (Request) => Response: serve it from Node, a serverless function or a worker.
```

It answers `POST /issue-connection`, the contract in
`communication-transcripts-adapter-openapi.yaml`. For Amazon Transcribe it
answers with a presigned WebSocket URL that carries its own credential, so no
AWS credential reaches the page. Credentials come from the environment
(`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`) unless
given, as an object or a function that gets them.

The URL is signed with AWS Signature Version 4, implemented here with Web
Crypto and no dependencies. Its tests check it against AWS's own signer, with
AWS's example key: signing is a local calculation, so no AWS account is
needed to test it.

## Adding a service

Amazon Transcribe and the replay adapter are examples; another service is
added the same way, and contributions are welcome. The transcription services
the contracts name are in the `transcription-services` registry
(`communication-transcripts-registry-transcription-services.yaml`), with how a
browser reaches each in `docs/architecture/domains/communication.md`,
Decision 12.

- **A client adapter** in `src/client/`, exported from `./client`: an object
  with `open`, as above. It speaks only the service's protocol; the driver
  does the rest.
- **An issuer** in `src/server/`, exported from `./server`: a function from a
  `ConnectionRequest` to a `StreamConnection`, given to
  `createTranscriptsAdapter` under the service's registry name. Throw
  `CantIssue` for a request the service can't take, naming the field.
- **Tests that need no account.** Check an issuer against the service's own
  SDK or documented examples with a made-up key, as the Transcribe signer is
  checked; check a client adapter by playing back messages recorded from one
  real session.

A service a browser can't reach, such as one that takes only gRPC, sits behind
a relay that implements the relay contract instead
(`communication-transcripts-relay-asyncapi.yaml`).

## License

[PolyForm Noncommercial 1.0.0](LICENSE)

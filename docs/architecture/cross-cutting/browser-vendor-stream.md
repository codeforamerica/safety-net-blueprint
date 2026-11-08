# Browser-to-Vendor Stream

How the blueprint handles something live that a browser streams to a vendor,
such as speech to a transcription service, while the blueprint keeps the
result. The rules are in
[`docs/conventions/patterns/browser-vendor-stream.yaml`](../../conventions/patterns/browser-vendor-stream.yaml);
this doc says why each one is there. Transcription is the first use, in the
[communication domain](../domains/communication.md#how-the-parts-work-together).

## When it fits

Use it when all of these hold:

- **The browser and a vendor exchange a live, continuous stream** — audio,
  video, a real-time conversation — where delay matters.
- **The raw stream shouldn't pass through the server.** Relaying it adds delay
  and cost, and the blueprint would have to hold something it doesn't need.
- **What's kept is a result derived from the stream,** such as text, not the
  stream itself.
- **The connection belongs to one browser tab** and doesn't need to outlive it.
- **The vendor issues browsers short-lived credentials,** or a relay the state
  runs can stand in for one that doesn't.

## When it doesn't

| Situation | Use instead |
|---|---|
| One request and one answer, such as checking a fact with an outside authority | The [adapter pattern](adapters.md), or Data Exchange |
| Content that's already stored, such as an uploaded document, or a recording transcribed after the fact | A server-side adapter that reads it |
| The raw stream has to be kept or audited | Stream through the state's own server and keep it there |
| The connection has to outlive the tab, or continue with no page open | A session on the server |

Each part below can also be left out where it isn't needed: a vendor every
browser can reach needs no relay, and a stream with no notion of "off the
record" needs no pause.

## The parts

| Part | Where it runs | Defined by | What it does |
|---|---|---|---|
| Page | Browser | The app | The user's screen; captures the stream and calls only the session |
| Client adapter | Browser | The app, for one vendor | Streams to the vendor and tells the session what happens |
| Session | Browser, kept there by routing | The blueprint: OpenAPI and a state machine | Tracks the connection; its actions call the record's operations |
| The record | Server | The blueprint: OpenAPI and a state machine | Keeps the result and its rules |
| Server adapter | Beside the server | The blueprint's contract; the state implements it | Holds the vendor's secret and issues a short-lived credential |
| Relay | The state's server, optional | The blueprint's relay contract, in AsyncAPI; the state implements it | Stands in for a vendor a browser can't reach |

## Why each rule

**The session runs in the page, kept there by routing.** It tracks one tab's
connection, which ends with the tab, and drafts of the result have to stay in
the browser. The record, which lasts, belongs on the server. The same contracts
run in either place; routing — per-environment configuration — decides where,
so no contract says where it runs, and a demo with no backend runs everything
in the page.

**The page and the client adapter talk only to the session.** One API for every
client adapter, whatever its vendor, keeps the contracts vendor-neutral, and
the session's state decides what's allowed — a line arriving after the session
failed is refused. The session calls the record by operationId, so routing
carries those calls to the server.

**Everything goes in as an action, and each action sends an event out.** That's
what a state machine is for: take actions in, check them against the state,
change the record, send events out. An action is the only way in that the
session's contract defines and its guards check; something sent straight to
the event stream would bypass them.

**Only finished results reach the server.** A draft is revised several times a
second and is the least reliable text there is; some never finish; and
whatever reads the record should see only what was finally heard. Drafts are
events for the page; the finished result is kept once, tied to its drafts by a
key the client gives, which is also its idempotency key, so a retry keeps it
once.

**A server adapter issues the credential.** Vendors design for browsers
connecting directly, with short-lived credentials, but issuing one takes the
vendor's secret, which can't be in a page. The adapter holds it and answers in
one shape for every vendor, named as OAuth names a token response.

**Getting a connection and opening it are two actions.** The blueprint never
touches the stream, so it can get where to connect and a credential, but only
the client knows whether the connection opened. Between the two, the session is
`connecting`, so a connection that fails to open has somewhere to land.

**A relay contract, for vendors a browser can't reach.** Some vendors take only
gRPC, and a model a state runs itself has no browser credentials. A relay the
state runs stands in for them, implementing a contract the blueprint defines,
so one client adapter works with any relay. It's one contract for the whole
connection — the stream in and the result back — because they travel over one
connection with one lifecycle.

**States come from a standard, and an action, its state and its event share one
word.** W3C WebRTC names a connection's states, and a developer already knows
them; where its word disagrees with the action, the session uses the word that
agrees, so `stop` leads to `stopping`. See
[naming](../../conventions/naming.yaml), `state_machine_names`.

**Going off the record stops the stream to the vendor.** Someone who asks to go
off the record expects not to be heard, not only not to be written down, and a
vendor that receives the stream may keep it. Disconnecting works the same with
every vendor; keeping a quiet connection open is done differently by each.

## Where it's used

- **Transcription**, in the communication domain: the transcription session,
  the transcript, the transcripts adapter and the relay contract. Its decisions
  are [Decisions 3 and 12 to 18](../domains/communication.md#key-design-decisions).

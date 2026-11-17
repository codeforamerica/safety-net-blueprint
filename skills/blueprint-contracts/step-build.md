# Step: build

Turn the agreed `scope.md` into a project folder: the contracts, an architecture doc per domain, the stories as scenarios that pass on the mock, and the explorer's pages. Nothing else: no screens and no client code, since the blueprint doesn't build those.

The scope says what to build. This step decides how, following the blueprint's conventions, and asks the developer about anything the scope left open. Don't add to the design silently: every addition the scope didn't name goes in the README's "Beyond the scope" section, and the developer approves it.

## The folder

| Path | What it is |
|---|---|
| `README.md` | What's here, where each thing is, how to open it, and how to rebuild after a change |
| `scope.md` | The scope, updated with what the developer decided during the build |
| `docs/{domain}.md` | One architecture doc per domain |
| `contracts/` | The contracts by domain, `overlays/`, and `scenarios/` |
| `explorer/` | The explorer's settings: `config.yaml` and `context-map/config/config.yaml` |
| `generated/` | What the tools produce: `resolved/`, `bundled/contracts.json`, `explorer/` |
| `package.json` | The pinned packages and one `regenerate` command |

## Steps

1. **List what to build.** Read `scope.md` in full. For each domain, list the files its "Kinds of contract" table calls for, then every record, stage, move, deadline, calculation, rule, announcement, reaction, setting, measure and story. Then look for what would stop you, the kinds of thing the scope step can miss:
   - an amount worked out from other data in a domain that says it has no rules (it needs a ruleset);
   - a measure whose announcements aren't listed;
   - a deadline with no move that starts or stops it;
   - someone or something that's free or busy, with no lifecycle of its own;
   - a "closest" or "first" with no tie-break;
   - an Open item, or a value "to be set".

2. **Ask once, with recommendations.** Put every question in one message, each with a recommended answer and what it means if they choose otherwise. Include the key facts each record holds, if the scope doesn't give enough to write its fields. Wait for the answers. Then show the changes to `scope.md` and save them, so the scope stays the record of what was decided. An item the developer leaves open is built with the recommendation, marked as a placeholder in the file and in the README.

3. **Set up.** Read [setup.md](setup.md) and follow it: the folder, the pinned packages, the roles, the explorer's settings and the `regenerate` command. Run it once on the empty project before writing contracts.

4. **Write the architecture docs.** One per domain, in the format [architecture-docs.yaml](reference/docs/conventions/architecture-docs.yaml) gives, carried over from the scope: the scope's per-domain subsections and decisions already line up with its sections. Show them and get agreement before writing contracts, since they're what the contracts implement.

5. **Write the contracts, one domain at a time,** in this order, running `npm run regenerate` after each file and fixing what it reports before going on:
   1. Records and their API: [creating-apis.md](reference/docs/guides/creating-apis.md), [resources.yaml](reference/docs/conventions/resources.yaml), [naming.yaml](reference/docs/conventions/naming.yaml).
   2. The lifecycle: [behavioral-contract-dsl.md](reference/docs/architecture/cross-cutting/behavioral-contract-dsl.md) and [rpc.yaml](reference/docs/conventions/rpc.yaml).
   3. Announcements and reactions: [events.yaml](reference/docs/conventions/events.yaml) and [inter-domain-communication.md](reference/docs/architecture/inter-domain-communication.md). Call another domain by `operationId`, never by path.
   4. Deadlines: [timers.md](reference/docs/architecture/cross-cutting/timers.md).
   5. Rules and calculations: [rules-guide.md](reference/docs/guides/rules-guide.md).
   6. Outside systems: [adapters.md](reference/docs/architecture/cross-cutting/adapters.md).
   7. Settings, measures, then sample data: [mock-server.md](reference/docs/guides/mock-server.md).

   When a part follows one of the blueprint's patterns (adapter, timers, cross-domain communication, composition and others, listed in [the index](reference/INDEX.md#patterns-which-one-to-use-and-how)), read its pattern file and follow its rules. Before each file, check [known-traps.md](known-traps.md). Where the docs and the packages disagree, the packages win: do what `regenerate` and the mock accept, and note it in the README.

6. **Check the main story by hand.** Start the mock (`npx blueprint-mock --spec=./generated/resolved`) and make the main story's calls in order. After each, read `GET /platform/events`: a reaction that didn't run often shows up only as a missing event, not as an error.

7. **Write the stories as scenarios,** one Arazzo file per story in `contracts/scenarios/`, as the [mock server guide](reference/docs/guides/mock-server.md#scenarios) says:
   - Each story's "Who" becomes the scenario's `x-actors`, and "Ends with" becomes its last checks.
   - A story that starts partway through starts from sample data.
   - An outside system's answer is an HTTP stub, registered by a step through the mock's own operations.
   - A deadline that should run out is a timer stub. Leave the stub out when the story needs something to happen before the deadline.
   - A step that checks a reaction retries (`onFailure`, a short `retryAfter`), since the reaction may run after the call answers.
   - With more than one API, name the API in every step (`$sourceDescriptions.{api}.{operationId}`).

   Run every scenario against a fresh mock with the snippet in the mock server guide, run with `node`. Don't save it in the project. Keep going until they all pass, or until what's left can't be expressed; say which and why.

8. **Write the README and report.** The README has:
   - what each folder holds, and how to open the explorer (`generated/explorer/index.html`);
   - how to run the mock and try it by hand;
   - how to rebuild after a change (`npm run regenerate`);
   - **Beyond the scope:** every addition the scope didn't name, and why;
   - **Placeholders:** values and choices built from a recommendation, not a decision;
   - **Workarounds:** each one from [known-traps.md](known-traps.md) used, and where.

   Then tell the developer, in a few lines: what passes, what's beyond the scope and needs their approval, and what's still open.

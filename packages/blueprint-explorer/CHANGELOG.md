# @codeforamerica/blueprint-explorer

## 0.4.0

### Minor Changes

- Before, the annotation explorer listed every entry's usages open on the page. Now each entry opens like an operation on the API reference, and shows the TypeScript client's `Annotations` call that finds those usages, which Run evaluates in the page. (#465)
- Before, an API reference page described each operation for reading only. Now each shows its curl and TypeScript call, and with Try it on, sends it to the mock running in the page, or for a rules endpoint, runs the client's evaluation in the page. (#465)
- Every page the explorer builds, except its authored pages, now has a Try it switch that docks a control panel beside the page: restart the mock, add stubs, fire waiting timers, and follow a log of each request and the events it set off. What the mock holds carries from page to page, and reloading a page starts it over. (#465)
- **Breaking:** The explorer no longer builds a Client Reference: `buildClientReference`, `--only=client-reference` and `--clients` are removed. Each operation on the API reference shows its TypeScript client call instead, and the annotation explorer shows the client's `Annotations` call. (#465)
- Before, running a contract set's scenarios in a browser meant building the harness's demo page, which isn't published. Now, for a contract set with scenarios, the explorer builds a Scenarios page that runs the mock server in the browser and plays each scenario a step at a time, served or opened from disk; `first_tour` in `config.yaml` picks the scenario it opens with. (#465)

### Patch Changes

- Before, asterisks inside a code span in a contract's description were read as italics, so the `q` parameter's example `*john*` showed as an italic john. Now a code span shows exactly what's written.
- The explorer's home page shows every tool in one grid without status badges, and each card lists up to four of its pages, then a link to all of them; a tool with nothing to show for the contract set gets no card.
- Before, building the explorer failed with ENOENT unless `config.yaml` and `context-map/config/config.yaml` existed. Now both are optional: the domains come from the contracts, the project is named "Blueprint", and the context map takes its title from that name. (#534)
- Uses @codeforamerica/blueprint-core 0.6.0, @codeforamerica/blueprint-rules-engine 0.2.2.

## 0.3.1

### Patch Changes

- Uses @codeforamerica/blueprint-core 0.5.0, @codeforamerica/blueprint-rules-engine 0.2.1.

## 0.3.0

### Minor Changes

- **Breaking:** Before, a state machine subscribed under `events:` and emitted full event names. Now it subscribes under `on:`, declares its resource's events once under `emits:` and sends them by name (`emit: claimed`), which resolve expands to `{domain}.{resource}.{event}`. (#470)
- **Breaking:** Before, the explorer drew sequence diagrams and context-map flows from hand-written `flows:`, `actors:` and `sequence-diagrams/config/` files that drifted from the contracts. Now those are gone: remove `flows:` and `actors:` from your explorer `config.yaml`, which no longer validates with them, and stop calling `buildSequenceDiagrams` or `--only=sequence-diagrams`. (#311)
- Before, a rules page drew its graph in three rows by kind, with no arrowheads, squashed to the page width. Now it's laid out by dependency with arrowheads, in a viewport you can zoom and pan, and a menu or an `#output-<name>` link shows one output with what it depends on. (#481)

### Patch Changes

- Before, a state machine's transitions were documented under its first machine's item path in the API its `apiSpec` named. Now each attaches to the resource it names, in whichever OpenAPI document of its domain declares it, so intake's Verification transitions appear under the verification. (#470)
- Each package now declares its license, `PolyForm-Noncommercial-1.0.0`, so npm and dependency scanners show it. The terms are unchanged. (#452)
- Before, the data dictionary documented only resources with a PATCH operation, so a domain whose resources are read-only got no dictionary at all. Now any `/{collection}/{id}` that returns a record is documented from what it returns; a GET that answers with a page of records is not taken for one. (#481)
- Before, the API reference linked fields to the data dictionary by schema name, so most links led nowhere — 599 of 622 on the intake page. Now it reads the domain's field inventory, links each field to the entry the dictionary actually has, and leaves a field it doesn't have unlinked. A page finds its dictionary by its document's domain, so platform-events links into the platform dictionary. (#481)
- Before, a ruleset page's "API endpoint" link went to the domain's API page, where a rules endpoint isn't — it's on the rules API's own page. Now the link goes to the page that documents it, and following a link to an endpoint opens its card instead of leaving it collapsed. (#481)
- Uses @codeforamerica/blueprint-core 0.4.0, @codeforamerica/blueprint-rules-engine 0.2.0.

## 0.2.1

### Patch Changes

- Before, building an explorer for a contract set with no rule graphs ended the whole build at that tool and exited 0, so the API reference, event catalog, client reference and hub went unwritten while every caller recorded a success. Now the tool is skipped, the build continues, and the hub links a section only where one was generated.
- Uses @codeforamerica/blueprint-core 0.3.0.

## 0.2.0

### Minor Changes

- `blueprint-explorer` is now a proper library. Each build tool is exported as a named function (`buildContextMap`, `buildDataDictionaries`, `buildApiReference`, etc.) from the package root so consumers can import and call them directly rather than spawning subprocesses into `src/`.
- The Explorer now generates a documentation page per ruleset, with the
  dependency graph drawn and every fact evaluable in the browser. (#425)
- **Breaking:** Annotation files key fields by spec-relative path
  (`application.members[].dateOfBirth`) rather than schema-relative path
  (`member.dateOfBirth`). The first segment is the camelCase schema name,
  followed by the dot-bracket field path. This matches the data dictionary and
  the field inventory, so one path form works across all three.

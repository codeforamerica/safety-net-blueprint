# How the server reads `$ref`

The server resolves references against the contract set when something needs
to see through one. It does not dereference the specs first.

That is a reversal: the server used to be handed specs with every `$ref`
inlined by `$RefParser`, and this records why it no longer is, because the old
way is the obvious way and someone will suggest it again.

## What changed

```
before   disk ──$RefParser reads files──▶ one flat spec per API ──▶ the server
                                          (no refs left to resolve)

after    disk ──discover/load──▶ docs, refs intact ──▶ the server
                                 (resolved by lookup, where needed)
```

## Why

**Nothing was missing in the first place.** A `$ref` in a contract set names
another document *in the same set*. `packages/generated/contracts` has 1089
external refs and every one of them points at a sibling. The set was always
complete; dereferencing only pre-flattened it.

**Flattening multiplies.** Dereferencing copies every shared schema into every
site that references it:

| | refs intact | dereferenced |
|---|---|---|
| harness contracts on disk | 212 K | 720 K |
| bundled artifact | **0.67 MB** | 3.95 MB |

In memory it multiplies the same way. The artifact is the number that matters,
because a browser downloads it.

**It makes a per-domain bundle possible.** `generate(docs, 'artifact', {
domains })` keeps a domain and follows its refs to a fixed point. That is only
computable *because* the refs are there — a dereferenced set has inlined
copies with no record of where they came from, so there is nothing to follow
and no way to know what is safely droppable.

**A browser cannot dereference anyway.** `$RefParser` reads files. Keeping it
on the critical path would have meant a second mechanism for the browser, and
two mechanisms that must agree.

## How resolution works

Three layers, each the narrowest thing that does the job.

**One hop, returning the node.** `src/schema-refs.js` follows a single `$ref`
and returns the node that is already there, not a copy of it. A caller walking
a schema tree meets refs as it goes and resolves each where it meets it, so
the cost is proportional to what is read.

**Metadata resolves its top hop.** `extractMetadata` applies that to the
things a caller needs whole — parameters, error responses, and the top of each
request and response schema — and leaves nested refs as refs. So
`endpoint.responseSchema` is the schema object rather than a pointer to it,
while what is inside it stays unflattened.

**ajv resolves its own.** `src/schema-registry.js` registers every document
under an identifier derived from its path, so a relative ref resolves by
ordinary URI arithmetic. A schema is addressed *by pointer* rather than handed
over as an object, because that is what tells ajv which document to resolve
from — a detached object carries no base, and the failure reads
`can't resolve reference … from id #`.

## What this cost

Four bugs, and every one of them passed the existing test suites, because
`tests/fixtures` and `tests/functional/resolved` were dereferenced and so had
no refs to resolve. They were caught only by running against the real contract
set:

- `nullable` stripped wholesale. ajv honours `{ type: string, nullable: true }`
  by widening the type, so removing it rejected the `null` the field exists to
  allow.
- The 2020-12 ajv build adopted for the dialect the documents declare. It
  enforces `unevaluatedProperties`, which draft-07 ignores, so seed data that
  had always passed began failing. Reverted — `createAjv` in
  `src/schema-registry.js` builds a draft-07 validator deliberately, and says
  so there.
- `extractRequiredDefaults` reading `allOf` members without following them, so
  a required array came back `undefined` instead of `[]` — silently.
- `extractExpandFields`, `extractLinksFields` and `extractDerivedFields` doing
  the same, so list items lost their `links`.

The fixture is no longer dereferenced, for that reason. Removing `--bundle`
from `tests/functional/setup.js` immediately failed, and the cause was an
invalid UUID in `ChildExample1` that the flag had been hiding by dropping the
record from seeding entirely.

## Where it is not resolved on demand

`$RefParser` remains in `src/spec-validator.js`, which dereferences a spec to
check that its refs *resolve* — a question about the tree, not a way of
reading it — and in two CLI scripts. All Node-only, none on the browser path.

## See also

- `ROUTING.md` — the route table and why the matcher is hand-rolled
- `src/schema-registry.js` — how documents are registered with ajv, and why the
  validator is built for draft-07 while the documents declare 2020-12

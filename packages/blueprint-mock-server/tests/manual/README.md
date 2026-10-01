# Manual checks

Two things the automated suites cannot answer, kept as scripts you run rather
than as tests that run themselves.

## `build-browser-check.js`

```bash
node tests/manual/build-browser-check.js
open tests/manual/generated/store-browser-check.html
```

Bundles the in-memory store and runs the store contract in a real browser. It
exists because two facts the browser path depends on are invisible to Node:
whether `file://` is a secure context, and therefore whether
`crypto.randomUUID` — which the store uses to mint ids — exists there at all.

`tests/unit/store-boundary.test.js` proves the module graph reaches nothing
Node-only, which is a different claim: that it *could* run in a browser, not
that it does.

**Last run:** 10/10 in Chrome 153 and Safari 27, both off `file://`,
`isSecureContext = true` in each. Firefox untested — Gecko follows the same
Secure Contexts text, and two independent implementations agreeing is reasonable
evidence, but it is evidence rather than proof.

Open the generated file **directly from disk**. Serving it over HTTP would make
every check pass for the wrong reason.

## `bench-stores.js`

```bash
node tests/manual/bench-stores.js
```

Compares the two stores on a workload shaped like the test suite's: seed, read
by id, paginated filtered list, update.

Worth running after touching a read path. It found a flaw no correctness test
could see — the in-memory store cloned every matching record *before*
paginating, so returning 25 rows out of 2,000 deep-copied 1,000 objects. Both
stores returned identical data; one of them just did far more work to do it. The
script prints a warning if `findAll` goes slower in memory than in SQLite, which
is that flaw's signature.

Not automated because timings vary by machine, and a threshold assertion would
turn flaky and then get deleted rather than fixed.

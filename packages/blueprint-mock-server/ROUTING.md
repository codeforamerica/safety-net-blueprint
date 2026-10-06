# Routing

How requests reach handlers, and why the router is written here rather than
installed. See the [README](./README.md#routing) for the short version.

## Shape

Every endpoint is a function from a `Request` to a `Response`:

```js
(request, ctx) => Response        // ctx carries the matched path params
```

That is `fetch`'s signature. They live in a table keyed by method and path
template, carrying the OpenAPI `operationId`:

```
'GET /intake/applications/{applicationId}'  →  { operationId, handler }
```

Two things follow. Making an endpoint real is assigning a different function to
`entry.handler` — no adapter, because a real `fetch` has the same signature and
ignores the second argument. And anything that can produce a `Request` can serve
the table: a Node server, a service worker, or a direct call in a test.

Path templates use OpenAPI's `{param}` syntax rather than Express's `:param`,
so the public surface doesn't carry the convention of a framework the package
no longer depends on.

## Two resolution rules

**A literal segment beats a parameter.** `/users/me` wins over
`/users/{userId}` whatever order they were registered in. Express decided this
by registration order, which made correctness depend on where a route happened
to be added.

**First registration wins a collision.** Composition routes are registered
before the standard ones precisely so their `sectionView` handlers take priority
on shared paths. A plain `Map.set` would be last-wins and would invert that
silently.

Both are covered in `tests/unit/route-table.test.js`.

## Why the matcher is ~40 lines rather than a dependency

Off-the-shelf Fetch-native routers exist and are browser-compatible — Hono and
itty-router among them — and `urlpattern-polyfill` supplies the W3C
`URLPattern` that Node 22 still lacks. The polyfill was measured rather than
assumed: **76K installed, 18 KB raw, 6 KB gzipped, zero dependencies**, and all
routing tests pass against it unchanged. It is a clean drop-in.

It was still the wrong trade, and the reason only appeared on the edge cases.
Diffing both implementations against a live Express app:

| request | Express | ours | `URLPattern` |
|---|---|---|---|
| `/a/1/` against `/a/{id}` | 200 | 200 | **404** |
| `/a/` against `/a` | 200 | 200 | **404** |
| `/a/.` against `/a/{id}` | 404 | **200** | 404 |

Express is non-strict about trailing slashes and `URLPattern` is not, so
adopting it would have begun returning 404 for `/applications/{id}/` across
every endpoint — silently, since nothing tested it.

The third row is ours: the matcher had been capturing `.` and `..` as parameter
values, handing a traversal-shaped string to the store where Express rejects it.
That defect existed before the comparison and was found by it.

A framework router would also have cost the plain-`Request` signature. Hono's
handlers take a context object, which reintroduces an adapter at exactly the
substitution point the table exists to keep free.

**What would change this.** If path templates ever need more than literal and
single-segment parameters — wildcards, optional segments, regex constraints —
hand-rolling stops being proportionate and `urlpattern-polyfill` is the
replacement to reach for, behind the same `matchPath` interface. OpenAPI paths
do not express those today.

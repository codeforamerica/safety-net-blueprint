# Why a custom dependency-graph engine

The decision-rules DSL (see [`FORWARD-VS-REVERSE-CHAINING.md`](./FORWARD-VS-REVERSE-CHAINING.md))
owes a real, direct debt to [IRS Direct File's open-source Fact Graph
engine](https://github.com/IRS-Public/fact-graph) (`github.com/IRS-Public/fact-graph`, CC0/public
domain) — Fact Graph is the reason this design didn't have to invent its structural model from
scratch, and is worth taking seriously as a candidate to adopt directly, not just borrow ideas
from. This doc summarizes why the actual decision was to build a new engine on Fact Graph's
proven ideas rather than adopt its runtime — see `decision-rules-dsl.md` (Decisions 1 and 2, on
the `design/decision-rules-dsl` branch, design issue #386) for the full reasoning, considerations,
and alternatives weighed.

## What this design owes to Fact Graph

The *idea*, not the artifact: a dependency graph of typed facts with three-valued completeness
(known / unknown / placeholder) tracked natively by the engine itself, not bolted on. Fact Graph
is the only comparable open-source engine purpose-built for exactly this shape of problem, and
using its structural model as a starting point avoids reinventing something it already got right.

## Why not adopt Fact Graph's runtime directly?

- Fact Graph's biggest practical asset — years of production hardening against real tax-law edge
  cases — is domain-specific to tax preparation and doesn't transfer to safety-net eligibility
  rules. Adopting its runtime would mean taking on its toolchain as an ongoing dependency without
  the one benefit that would justify that cost.
- Running it means carrying its Scala/JVM/Scala.js toolchain permanently — a second
  language/runtime this team doesn't otherwise maintain.
- Fact Graph's own maintainers describe its Java/JavaScript consumption API as leaky and
  undocumented — an acknowledged issue in their own architecture record, not a hypothetical
  concern.
- Fact Graph is authored in XML, using a nested operator-tree syntax for expressions. This
  blueprint had already chosen CEL as its one expression language everywhere else (guards, SLA
  conditions, metric filters), specifically to avoid that kind of verbose nested-tree syntax —
  adopting Fact Graph's own format would reintroduce exactly the problem that earlier decision
  avoided.

## What building new actually costs, and how that cost is managed

The real risk of building a new engine instead of adopting Fact Graph's is losing its hardening
around genuinely tricky mechanics — collection/wildcard path resolution, for instance, needed a
bug fix in Fact Graph's own codebase as recently as March 2026, which is real evidence this is a
hard area to get right even for the team that built it.

The mitigation is a bootstrap validation, not a permanent runtime dependency: mining *every one* of
Fact Graph's own per-operator test specs (real Scala test files with known-correct
input/expected-output pairs) — not a representative sample — and re-asserting the same values
against the new engine, without ever needing to run Fact Graph's actual Scala runtime. Once that
full reproduction passes, there's no *ongoing* dependency — rule authoring happens against the new
engine, not against Fact Graph's runtime.

"Not an ongoing dependency" doesn't have to mean "check once and never again," though. Since we
never run Fact Graph itself, there's no automatic way of learning when its team fixes a bug —
including exactly the kind of subtle mechanics bug already flagged as a real risk above (the
collection/wildcard path-resolution fix in their own March 2026 release). Without some periodic
check, a correctness improvement or a since-fixed bug in Fact Graph's own logic could sit there
un-mirrored in this engine indefinitely, with nothing prompting anyone to notice.

This hasn't been decided as part of the actual design record yet — worth raising rather than
leaving implicit (see the corresponding known-gap note on Decision 2 in `decision-rules-dsl.md`).
Possible mitigations, roughly in order of cost: (1) periodically re-run the same
bootstrap-validation exercise against Fact Graph's *current* test specs (e.g. annually, or
triggered by a specific need) to pull in whatever's changed since the last check; (2) simply watch
Fact Graph's release notes/changelog for corrections worth investigating, given it's a small,
low-traffic open-source project — cheap, but relies on someone remembering to look; (3) treat it
as a non-issue and accept the drift risk, on the reasoning that Fact Graph's tax-specific hardening
was never fully applicable to this domain anyway (per the reasoning above).

## Risks and mitigations, at a glance

| Risk | Mitigation |
|---|---|
| Losing Fact Graph's own hardening on tricky mechanics (e.g. its own collection/wildcard path-resolution bug fix, March 2026) | **Bootstrap validation:** reproduce *every one* of Fact Graph's own per-operator test specs against the new engine — not a sample — once, before rule authoring begins |
| Ongoing risk 1 creates: that reproduction is a snapshot at one point in time, not a standing guarantee — Fact Graph's own logic can still improve or get fixed afterward with nothing prompting a recheck | Periodic re-validation against Fact Graph's *current* test specs, watching its changelog, or accepting the drift risk — an open decision, not yet settled (see the known-gap note on Decision 2) |

## Where this spike fits in

This translator spike (issue #388) is a separate but related piece of derisking: it proves whether
a *real* forward-chaining ruleset (Corticon, not Fact Graph) can be mechanically classified and
translated into this same dependency-graph DSL — a different question from "should we adopt Fact
Graph," but one that depends on the same underlying DSL design holding up against real-world rule
content.

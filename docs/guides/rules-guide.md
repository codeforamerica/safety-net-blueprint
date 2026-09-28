# Rules Guide

> **Status: Draft**

A ruleset is a dependency graph of named facts. You declare what the caller
supplies, what the rules compute, and which of those are answers. The evaluator
walks the graph and returns every fact with its state, against whatever data it
was given — including incomplete data.

This guide is about authoring one. For why the model is shaped this way, see
[Rules Contracts](../architecture/rules-contracts.md).

## When a ruleset is the right artifact

Use a ruleset when the question is **what is true of this case**. Eligibility
tests, which verifications are needed, which interview prompts to surface,
whether a determination can be made yet.

Use something else when the question is:

| Question | Artifact |
|---|---|
| May this transition happen? | a state machine guard |
| Which rows appear in this view? | a composition `filter:` |
| Has this taken too long? | an SLA definition |

The distinction that matters: a ruleset answers questions about data. It does
not decide what happens next, and it has no notion of elapsed time.

## Anatomy

```yaml
$schema: "https://blueprint.codeforamerica.org/schemas/rules-schema.yaml"
domain: intake

rulesets:
  interviewPrompts:
    endpoint:
      path: /applications/evaluate-interview-prompts

    inputs:
      household:
        type: object
        properties:
          monthlyIncome: { type: number }

    outputs:
      incomeInconsistencyProbe: { type: boolean }

    facts:
      - path: incomeGapExists
        expression: household.monthlyIncome < household.monthlyExpenses
      - path: incomeInconsistencyProbe
        expression: incomeGapExists
```

`inputs` are values the caller supplies. `facts` are computed. `outputs` names
the facts that are answers — everything else is an intermediate, still returned
but marked as such.

Declaration order does not matter. A fact may reference one declared below it;
the evaluator resolves topologically.

## Inputs: declare data, not conclusions

This is the decision that most affects whether a ruleset is reusable.

An input named `isNonCitizen` means whoever calls the endpoint decides what
"non-citizen" means. Two integrators will disagree about whether a US national
counts, and nothing in the contract says who is right. An input named
`citizenshipStatus`, with the derivation written as a fact, is decided once:

```yaml
inputs:
  members[].citizenship.citizenshipStatus    # the domain's own field

facts:
  - path: hasNonCitizen
    expression: "members.exists(m, m.citizenship.citizenshipStatus == 'non_citizen')"
```

The rule of thumb: **if a caller would have to write code to produce an input,
that code belongs in `facts:`.**

Every input must also be individually absent-able. Partial evaluation is the
point — a caller supplies what it has, and the response says what is still
needed. An input that is only meaningful alongside three others cannot be
reported as missing on its own.

### Three ways to connect a ruleset to the domain

Declaring `members[].citizenship.citizenshipStatus` by hand is the simplest
option, and the one to reach for first. It keeps the graph small, because only
the fields the expressions read become inputs. The cost is drift: nothing
checks that the shape you wrote still matches the domain schema.

**`$ref` the domain schema** when you want that checked. A ref is followed when
the graph is compiled, down to individual field paths and through array items,
so leaf-level dependency tracking survives:

```yaml
inputs:
  household:
    type: object
    properties:
      members:
        type: array
        items:
          $ref: "../../common/schemas/identity.yaml#/$defs/ApplicationMember"
```

The cost is that every field on the referenced schema becomes an input,
including ones no expression reads, which inflates the graph a browser has to
carry. Refs to a leaf rather than an object avoid that and still source the
type from the domain.

**Point at a composition** when the mapping is real work — several resources
assembled, fields renamed, records filtered. A composition already does exactly
that and is already validated, so the mapping lives in a contract rather than
in an unwritten caller.

What none of these do yet is connect at runtime: a rules endpoint evaluates
whatever body it is given. A composition documents and validates the mapping;
it does not enforce it.

## Facts

A fact is a CEL expression over inputs and other facts. Name it for what it
checks, not for a catalog identifier — fact names are what the Explorer's graph
view displays, so `abawdScreeningPrompt` reads and `promptWR02` does not.
Identifiers belong on annotations.

Facts may be declared in any order.

## Types

Two things about a declared type change the answers a ruleset gives.

**`integer` means integer arithmetic.** Division truncates: an income of 7
divided by 4 is 1, not 1.75. That is CEL's behaviour for two integers and what
the declaration asks for, but in a benefit calculation it is a policy choice.
A fact that wants real division converts explicitly — `double(x) / 4.0`.

**Prefer `format: date` over `date-time`** unless a rule genuinely depends on
time of day. Dates compare and subtract cleanly; instants carry timezone
semantics a determination rarely wants. Time-of-day belongs in SLA definitions
and state machine transitions, which is where the blueprint already puts it.

For money, `number` is evaluated in binary floating point, so `0.1 + 0.2` is
not exactly `0.3`. That only changes an answer on exact-equality comparisons
and long accumulation chains, not on threshold tests. Where exactness matters,
declare integer cents.

## Endpoints

A ruleset may declare a standalone POST endpoint:

```yaml
endpoint:
  path: /applications/evaluate-interview-prompts
```

Path parameters are not permitted. Nothing binds a path segment to ruleset
inputs, so a parameter would be accepted and silently ignored — the path would
promise resource hydration the endpoint does not perform. Identifiers go in the
body with everything else.

## Examples

A sibling `{domain}-rules-examples.yaml` provides worked input sets:

```yaml
$schema: "https://blueprint.codeforamerica.org/schemas/rules-examples-schema.yaml"
domain: intake

rulesets:
  interviewPrompts:
    examples:
      - description: Income gap and unemployed members
        inputs:
          household:
            monthlyIncome: 800
            monthlyExpenses: 1200
```

`blueprint-evaluate` runs every ruleset and example in one pass, which is how a
ruleset gets exercised without writing code. Examples carry inputs only —
pinning expected results is the conformance corpus's job, and a second set of
expectations would drift from it.

Examples may be partial. One that leaves an input out demonstrates what the
ruleset reports as missing, which is usually the more interesting case.

## What validation checks

`blueprint-validate` reports cycles, facts that are never used and not declared
as outputs, CEL expressions that do not parse, and `$.path` references that do
not match the declared inputs. It does not check that an expression computes
the right answer — that is what examples and the conformance corpus are for.

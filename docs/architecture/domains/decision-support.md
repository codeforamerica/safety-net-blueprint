# Decision Support Domain

> **Status: designed, not built.** Suggestions will be the framework's
> `suggestions` capability, in a `decision-support` domain
> (`blueprint-core/base-contracts/domains/decision-support/`).

See [AI Services](../cross-cutting/ai-services.md) for how suggestions fit with
transcripts and fact extraction, and [Contract-Driven Architecture](../contract-driven-architecture.md)
for the contract approach.

## Overview

The Decision Support domain holds what is put in front of a person to help them
act on a record — a value to fill in, a question to ask, a risk to look into —
and that person's decision on it. A suggestion can come from an assistant, a
rule or another person; nothing in it is specific to AI, or to any one kind of
record. It looks at one record at the moment of acting: reporting across
records stays with each domain's metrics. In the safety net contracts, the
first use is an assistant following an eligibility interview.

The framework provides it, and a contract set includes it by
listing the `suggestions` capability ([Decision 1](#decision-1-a-framework-domain-a-set-opts-into)).

## What happens when something is suggested

1. Something proposes a change or points something out — an assistant listening
   to a conversation, a rule noticing missing information, a colleague. It says
   what it is about, where it came from, and who proposed it.
2. The proposal is checked as it arrives: what it is about and the sources it
   cites exist, and a proposed change is one the contracts allow, in the shape
   they require. A change already turned down for that record is refused.
3. The person deciding sees it beside its evidence — the lines of the
   conversation, the page of the document — and decides.
4. Accepting a proposed change makes the change, as that person, under the same
   rules as making it by hand. They can correct it first.
5. If the change cannot be made — the person may not make it, or the record no
   longer allows it — the attempt is recorded and they can try again, until
   the attempts allowed run out.
6. A suggestion that no longer applies is closed by whatever created it: a
   conversation ending closes the suggestions made during it.

## Entity model

### Suggestion

One thing put in front of a person, and their decision on it.

- **Kind** — it either proposes a change, naming the operation that makes it and
  its arguments, or informs, with a category and the details that category
  defines. A proposed change needs no category: the operation says what it is.
  See [Decision 2](#decision-2-two-kinds-a-proposed-operation-or-information).
- **Subject** — the record it is about.
- **Who proposed it** — in the same terms events use to say who caused them, so
  a rule, a service and a person are told apart the same way everywhere.
- **Confidence** — how sure a model was, from a model only. For display and
  review; nothing in the lifecycle reads it.
- **Evidence** — references to where it came from: lines of a transcript, a page
  of a document, a fact a ruleset derived, a data match. See
  [Decision 6](#decision-6-evidence-refers-it-does-not-quote).
- **Context** — what it was proposed during, such as a conversation, by the
  cross-domain pass-through convention, so everything proposed during it can be
  listed together.
- **What was performed** — the arguments as they were accepted, when they
  differ from what was proposed.
- **Attempts** — each accept that failed: when, by whom, what was tried and why
  it failed.
- **Fingerprint** — what identifies the change, for refusing it once dismissed.
  See [Decision 7](#decision-7-a-dismissed-change-is-not-proposed-again).
- **Dismissal reason**, what it **superseded** or was superseded by, and an
  optional **expiry**.

### Category

A kind of informing suggestion, declared by the domain it belongs to — in the
safety net contracts, eligibility declares "missing determination input" and
intake "risk" and "inconsistency" — with the shape of its details and the fields that identify
the same one. Categories are registry entries, so any domain or state adds its
own with a file.

## Suggestion lifecycle

| State | Description | SLA clock |
|---|---|---|
| Proposed | Waiting for a person to decide. | none |
| Accepted | A person said yes, and for a proposed change, it was made. Terminal. | none |
| Refused | A person said yes, and the change could not be made. Waiting for a retry. | the retry timeout |
| Failed | The change could not be made within the attempts or time allowed. Terminal. | none |
| Dismissed | A person said no, with a reason. Terminal. | none |
| Expired | It no longer applies. Terminal. | none |
| Superseded | A newer suggestion replaced it. Terminal. | none |

Accepting a proposed suggestion that fails moves it to refused, with the attempt
recorded; accepting again tries again. After the most attempts allowed, or no
retry before the timeout, it fails. A refused suggestion can still be dismissed.
For an informing suggestion, accepting means the person took it up.

## Domain events

| Event | Why it's needed | Trigger | Primary consumers |
|---|---|---|---|
| `decision-support.suggestion.proposed` | Something needs a person's decision | Proposing | The decider's screen |
| `decision-support.suggestion.accepted` | A person said yes; for a proposed change, it was made, and the change's own events name this one as their cause | Accepting | Audit; whatever proposed it |
| `decision-support.suggestion.refused` | A person said yes and the change could not be made | A failed accept | The decider's screen; anything that can route it to someone who may make it |
| `decision-support.suggestion.failed` | It cannot be done | The last attempt failing, or the timeout | Workflow, to make a follow-up task |
| `decision-support.suggestion.dismissed` | A person said no | Dismissing | Audit; whatever proposed it, to learn from |
| `decision-support.suggestion.expired` | It no longer applies | Expiring | The decider's screen |
| `decision-support.suggestion.superseded` | A newer one replaced it | Proposing its replacement | The decider's screen |

## Contract artifacts

To be built in `blueprint-core/base-contracts/domains/decision-support/`.

| Artifact | File |
|---|---|
| API — suggestions | `decision-support-suggestions-openapi.yaml` |
| Lifecycle | `decision-support-suggestions-state-machine.yaml` |
| Events | Generated by resolve beside the API, from the API and the state machine |
| Categories | A `suggestion-categories` registry, in each owning domain's registry files |

## Key design decisions

| # | Decision | Summary |
|---|---|---|
| 1 | [A framework domain a set opts into](#decision-1-a-framework-domain-a-set-opts-into) | Not on platform, not in intake |
| 2 | [Two kinds: a proposed operation, or information](#decision-2-two-kinds-a-proposed-operation-or-information) | A change names its operation; anything else has a category |
| 3 | [One suggestion is one change](#decision-3-one-suggestion-is-one-change) | A patch of five changes is five suggestions |
| 4 | [Accepting performs the change as the person who accepts](#decision-4-accepting-performs-the-change-as-the-person-who-accepts) | The same permissions and rules as making it by hand |
| 5 | [A failed accept is recorded and can be retried](#decision-5-a-failed-accept-is-recorded-and-can-be-retried) | Refused, then failed after the limits |
| 6 | [Evidence refers, it does not quote](#decision-6-evidence-refers-it-does-not-quote) | Nothing sensitive copied out of its source |
| 7 | [A dismissed change is not proposed again](#decision-7-a-dismissed-change-is-not-proposed-again) | Sameness is declared, not guessed |
| 8 | [Whoever created a suggestion closes it](#decision-8-whoever-created-a-suggestion-closes-it) | A conversation ending expires what was proposed during it |

### Decision 1: A framework domain a set opts into

**Status:** Decided: C

**What's being decided:** Every domain can have something to suggest, and not
every contract set wants suggestions at all, so where Suggestion is defined
decides who can use it and who has to carry it.

**Considerations:**
- Suggestions come from rules and people as well as assistants, and about
  records in any domain.
- Suggestion has a lifecycle and decisions of its own; platform holds only
  infrastructure (see [Platform](../cross-cutting/platform.md#decision-3-the-platform-is-infrastructure-only)).
- Clinical decision support is the established name for this: its standard,
  HL7 CDS Hooks, returns suggestions carrying actions to perform, and records
  whether each was accepted or overridden, and why.

**Options:**
- **(A)** In the domain of its first use — intake, in the safety net
  contracts. Another domain could not use it, and neither could another set.
- **(B)** On platform. Every contract set would carry it, wanted or not.
- **(C) ✓** In a `decision-support` domain the framework provides, as the
  `suggestions` capability a set lists.

### Decision 2: Two kinds: a proposed operation, or information

**Status:** Decided: B

**What's being decided:** Some suggestions are changes to make and some are only
things to notice, so how a suggestion says what it is decides what accepting
it does.

**Considerations:**
- The contracts already name every change a person can make, as an operation
  with its request schema; Arazzo names an operation the same way.
- A question to ask or a risk to probe changes nothing, and differs by domain.
- Data exchange already gives each service type its own result schema.

**Options:**
- **(A)** A patch to any record, applied on accept. It would bypass each
  operation's own rules.
- **(B) ✓** A proposed change names its operation and arguments, checked against
  the contracts when proposed. Everything else names a category its domain
  declares, with details in that category's shape.

### Decision 3: One suggestion is one change

**Status:** Decided: B

**What's being decided:** A model reading a conversation can find several changes
at once, so how they are grouped decides what a person can accept or turn down.

**Considerations:**
- A person may agree with three of five changes.
- A dismissed change is remembered so it is not proposed again, which needs each
  change on its own.

**Options:**
- **(A)** One suggestion per batch, accepted or dismissed whole.
- **(B) ✓** One suggestion per change. Whatever turns a result into suggestions
  splits it.

### Decision 4: Accepting performs the change as the person who accepts

**Status:** Decided: B

**What's being decided:** Accepting a proposed change makes it, so whose
authority it is made under decides whether a suggestion can do what the person
accepting it could not.

**Considerations:**
- An operation's permissions and rules already say who may make a change and
  when.
- An audit has to show who decided, and which change came from which
  suggestion.

**Options:**
- **(A)** The system makes it. A suggestion could do what the person may not.
- **(B) ✓** It is made as the person who accepts, under the operation's own
  permissions and rules, and its events name the acceptance as their cause.
  They can correct the arguments first.

### Decision 5: A failed accept is recorded and can be retried

**Status:** Decided: B

**What's being decided:** Between a suggestion being proposed and accepted, the
record can change, or the person may lack the permission, so what happens when
the change cannot be made decides whether a yes is ever lost.

**Considerations:**
- Someone said yes; losing that silently loses work.
- Step Functions, Serverless Workflow and Arazzo all let a step fail to an
  alternative, with retry limits declared in the workflow.
- Data exchange's retries need the same thing.

**Options:**
- **(A)** The accept fails and the suggestion stays proposed. Nothing records
  the attempt.
- **(B) ✓** The suggestion is refused, with the attempt recorded, and a person
  can retry. After the attempts or time allowed, it fails, and anyone can
  subscribe to that. The limits are declared once and changed by overlay.

### Decision 6: Evidence refers, it does not quote

**Status:** Decided: B

**What's being decided:** A person needs to see why something was suggested, and
the sources are often sensitive, so how evidence is kept decides where
sensitive text ends up.

**Considerations:**
- A transcript line or a document page has its own access rules.
- A copy outlives changes to its source and escapes its rules.

**Options:**
- **(A)** Quote the source in the suggestion.
- **(B) ✓** Refer to it — which lines, which page, which fact — so the source's
  own rules apply when it is shown. A transcript cited as evidence has to be
  kept at least as long as the suggestion.

### Decision 7: A dismissed change is not proposed again

**Status:** Decided: B

**What's being decided:** A service that re-reads a whole conversation keeps
finding the same changes, so how sameness is judged decides whether a person
sees one already turned down.

**Considerations:**
- What makes two changes the same depends on the change: adding a person to a
  record is the same change by name and birth date, not by every field.
- Personal values should not be readable from whatever is kept to compare.

**Options:**
- **(A)** Compare the whole proposal. A trivial difference gets it through.
- **(B) ✓** Each operation and category declares which fields identify it, and
  overlays can change them. The comparison is a keyed hash of those values,
  normalized, so they cannot be read back from it.

### Decision 8: Whoever created a suggestion closes it

**Status:** Decided: B

**What's being decided:** Suggestions made during a conversation stop applying
when it ends, so who decides that decides whether the domain has to know about
conversations, or about anything else that creates suggestions.

**Considerations:**
- Only the process that made a suggestion knows when it stops applying.
- Some suggestions have nothing else that would close them.

**Options:**
- **(A)** Decision support expires suggestions by rules of its own.
- **(B) ✓** Whatever created a suggestion expires it — a conversation ending
  expires what was proposed during it — and one nothing else would close can carry an expiry time.

## Customization

| Element | Reason | Decision |
|---|---|---|
| Accepting performs the change as the person who accepts | A suggestion could otherwise do what that person may not | [Decision 4](#decision-4-accepting-performs-the-change-as-the-person-who-accepts) |
| Every failed accept is recorded | A yes would otherwise be lost silently | [Decision 5](#decision-5-a-failed-accept-is-recorded-and-can-be-retried) |
| Evidence refers to its source | A copy escapes the source's access rules | [Decision 6](#decision-6-evidence-refers-it-does-not-quote) |

### Including suggestions

A contract set includes suggestions by listing the `suggestions` capability in
its configuration. A set that does not has none of it.

### Who may decide

Accepting and dismissing are guarded like any transition; an overlay can narrow
who may.

### Categories

A domain or state adds categories with a registry file of its own.

### Retry limits

The attempts allowed and the retry timeout are declared once and changed by
overlay.

### What identifies a change

The fields that identify an operation's change or a category's are declared
with it, and changed by overlay.

## Out of scope

- **Producing suggestions** — assistants, rules and extraction services propose
  them; see [AI Services](../cross-cutting/ai-services.md).
- **Reporting** — across records, from each domain's metrics.
- **The decision itself** — the person's, under the rules of the domain that
  owns the record; a suggestion only helps them make it.

## Capability coverage

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Suggestions a person accepts or dismisses | CDS Hooks cards and their suggestions | planned |
| Recording acceptance and override with a reason | CDS Hooks feedback | planned |
| Not repeating a dismissed suggestion | — | planned |

## References

- [HL7 CDS Hooks](https://cds-hooks.hl7.org/)
- [AI Services](../cross-cutting/ai-services.md)
- [Platform](../cross-cutting/platform.md)
- [Communication](communication.md) — transcripts, which suggestions cite as evidence

# Decision Support Domain

> **Status: partly built.** Suggestions are the framework's `suggestions`
> capability, in a `decision-support` domain
> (`blueprint-core/base-contracts/domains/decision-support/`). Proposing and
> reading them is built, with the proposal checked against the contracts, and
> so are accepting, dismissing and expiring them, and refusing a proposal that
> repeats one open or dismissed. The harness's interview puts its flags to the
> worker as suggestions, end to end, walked through in
> `blueprint-harness/contracts/scenarios/interview-suggestions.arazzo.yaml`.

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
   what it is about and where it came from.
2. The proposal is checked as it arrives: a proposed change is one the
   contracts allow, in the shape they require, and anything else is in a
   category the set declares. One already open, or already turned down, is
   refused.
3. The person deciding sees it beside its evidence — the lines of the
   conversation, the document — and decides.
4. Accepting a proposed change makes the change, as that person, under the same
   rules as making it by hand. They can correct it first.
5. If the change cannot be made — the person may not make it, or the record no
   longer allows it — the failure is recorded in an event and they can try
   again until the suggestion expires.
6. A suggestion that no longer applies is closed by whatever created it: a
   conversation ending closes the suggestions made during it. One nobody
   decides expires after a day.

## Entity model

### Suggestion

One thing put in front of a person, and their decision on it.

- **Kind** — it either proposes a change, naming the operation that makes it and
  its arguments, or informs. A proposed change needs no category, and no
  subject: the operation says what it is, and its arguments which record it
  changes. See [Decision 2](#decision-2-two-kinds-a-proposed-operation-or-information).
- **Subject** — for an informing suggestion, the record it is about, and
  optionally the field within it.
- **Category and message** — for an informing suggestion, what kind of thing it
  points out, and what it says in words of its own: a category, a message, or
  both. A rule's suggestion has only a category, whose description is what a
  person reads; a model's usually adds a message about the conversation. One
  with no category is something no category covers yet.
- **Confidence** — how sure a model was, from a model only. For display and
  review; nothing in the lifecycle reads it.
- **Evidence** — references to where it came from: lines of a transcript, a
  document, a data match. See
  [Decision 6](#decision-6-evidence-refers-it-does-not-quote).
- **Context** — what it was proposed during, such as a conversation, by the
  cross-domain pass-through convention, so everything proposed during it can be
  listed together.
- **What was performed** — the call as it was accepted, when the person changed
  it first.
- **Fingerprint** — what identifies it, for refusing the same one again. See
  [Decision 7](#decision-7-the-same-suggestion-is-not-proposed-twice).
- **Dismissal reason**, and when it **expires**.

Nothing on a suggestion says who proposed or decided it, or when: each state's
event says who caused it and when.

### Category

A kind of thing an informing suggestion points out, declared by the domain it
belongs to — "a name that doesn't match", "income not on the record". Categories
are registry entries, an id and a description, so any domain or state adds its
own with a file. The framework declares none. A narrow category makes a
dismissal specific: dismissing one suggestion refuses the same category about
the same field of the same record, however it is worded.

A model can find something no category covers. It proposes it with a message
and no category, rather than in the wrong one; it cannot add a category, since
categories are defined only in the contracts. Uncategorized suggestions are
listed with `q=kind:informing -category:*`, and one that keeps appearing
becomes a category by a change to the registry.

## Suggestion lifecycle

| State | Description | SLA clock |
|---|---|---|
| Proposed | Waiting for a person to decide. | none |
| Accepted | A person said yes, and for a proposed change, it was made. Terminal. | none |
| Refused | A person said yes, and the change could not be made. Waiting for a retry. | none |
| Dismissed | A person said no, with a reason. Terminal. | none |
| Expired | It no longer applies. Terminal. | none |

Accepting a proposed suggestion that fails moves it to refused, and the
`refused` event carries the call and the error; accepting again tries again,
until it expires. A suggestion's history, failures included, is its events:
`GET /platform/events?subject={id}`. A refused suggestion
can still be dismissed. For an informing suggestion, accepting means the person
took it up.

A person can correct a proposed change before accepting it by sending the call
with the accept: it must name the same operation, and accepting makes that call
instead, keeping it as what was performed. A call naming another operation, or
any call sent to accept an informing suggestion, is refused with `409`.

## Domain events

| Event | Why it's needed | Trigger | Primary consumers |
|---|---|---|---|
| `decision-support.suggestion.created` | Something needs a person's decision; proposing is creating it | Proposing | The decider's screen |
| `decision-support.suggestion.accepted` | A person said yes; for a proposed change, it was made, and the change's own events name this one as their cause | Accepting | Audit; whatever proposed it |
| `decision-support.suggestion.refused` | A person said yes and the change could not be made; carries the call and the error | A failed accept | The decider's screen; anything that can route it to someone who may make it |
| `decision-support.suggestion.dismissed` | A person said no | Dismissing | Audit; whatever proposed it, to learn from |
| `decision-support.suggestion.expired` | It no longer applies | Expiring, or its timer | The decider's screen; workflow, for a refused one nobody retried |

## Contract artifacts

In `blueprint-core/base-contracts/domains/decision-support/`.

| Artifact | File |
|---|---|
| API — suggestions | `decision-support-suggestions-openapi.yaml` |
| Lifecycle | `decision-support-suggestions-state-machine.yaml` |
| Events | Generated by resolve beside the API, from the API and the state machine |
| A call to an operation | `OperationCall`, in `blueprint-core/base-contracts/schemas/operations.yaml` |
| Categories | A `suggestion-categories` registry, in each owning domain's registry files |

## Key design decisions

| # | Decision | Summary |
|---|---|---|
| 1 | [A framework domain a set opts into](#decision-1-a-framework-domain-a-set-opts-into) | Not on platform, not in intake |
| 2 | [Two kinds: a proposed operation, or information](#decision-2-two-kinds-a-proposed-operation-or-information) | A change names its operation; anything else has a category |
| 3 | [One suggestion is one change](#decision-3-one-suggestion-is-one-change) | A patch of five changes is five suggestions |
| 4 | [Accepting performs the change as the person who accepts](#decision-4-accepting-performs-the-change-as-the-person-who-accepts) | The same permissions and rules as making it by hand |
| 5 | [A failed accept is recorded and can be retried](#decision-5-a-failed-accept-is-recorded-and-can-be-retried) | Refused, and retried by a person until it expires |
| 6 | [Evidence refers, it does not quote](#decision-6-evidence-refers-it-does-not-quote) | Nothing sensitive copied out of its source |
| 7 | [The same suggestion is not proposed twice](#decision-7-the-same-suggestion-is-not-proposed-twice) | The whole call, or the subject and category |
| 8 | [Whatever gives suggestions their context creates and closes them](#decision-8-whatever-gives-suggestions-their-context-creates-and-closes-them) | Its state machine evaluates the rules, creates the suggestions, and expires them; anything left expires after a day |

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
  the contracts when proposed, in the shape an Arazzo step names a call.
  Everything else names a category its domain declares, says what it points
  out in a message, or both.

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

**Status:** Decided: C

**What's being decided:** Between a suggestion being proposed and accepted, the
record can change, or the person may lack the permission, so what happens when
the change cannot be made decides whether a yes is ever lost.

**Considerations:**
- Someone said yes; losing that silently loses work.
- Step Functions, Serverless Workflow and Arazzo all let a step fail to an
  alternative, with retry limits declared in the workflow; data exchange's
  automatic retries will need those limits. A person retrying does not.

**Options:**
- **(A)** The accept fails and the suggestion stays proposed. Nothing records
  the attempt.
- **(B)** The suggestion is refused, with the attempt recorded, and a person
  can retry. After the attempts or time allowed, it fails, and anyone can
  subscribe to that. The limits are declared once and changed by overlay.
- **(C) ✓** The suggestion is refused, its `refused` event carrying the call
  and the error, and a person can retry until it expires. The suggestion keeps
  no list of attempts: its events are its history, read with
  `GET /platform/events?subject={id}`. Expiry already ends a suggestion nobody
  acts on, so a separate retry timeout and a limit on attempts add nothing yet.

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
- **(B) ✓** Refer to it — which lines, which document — so the source's
  own rules apply when it is shown. A transcript cited as evidence has to be
  kept at least as long as the suggestion.

### Decision 7: The same suggestion is not proposed twice

**Status:** Decided: C

**What's being decided:** A service that re-reads a whole conversation keeps
finding the same changes, so how sameness is judged decides whether a person
sees one twice, or one already turned down.

**Considerations:**
- A proposed change differing in anything at all — even a note — is a
  different change, and a person may accept it after dismissing the first.
- A model rewords the same point from one reading to the next, so a message is
  not what identifies an informing suggestion.
- Personal values should not be readable from whatever is kept to compare.

**Options:**
- **(A)** Compare everything, the message included. A reworded point gets
  through.
- **(B)** Each operation and category declares which fields identify it. It
  needs a new extension on every operation a suggestion can name, and a schema
  in each category's registry entry.
- **(C) ✓** A proposed change is identified by its whole call; an informing
  suggestion by its subject, the field within it, and its category — or, with
  no category, its message. A
  proposal matching one still open, or one dismissed, is refused. The
  comparison is a keyed hash of those values, normalized, so they cannot be
  read back from it.

### Decision 8: Whatever gives suggestions their context creates and closes them

**Status:** Decided: C

**What's being decided:** Rules can find things to suggest — income below
expenses, a member with no medical costs — but a suggestion only makes sense
in some context: during a conversation, while a record is under review. What
evaluates the rules and creates the suggestions decides whether the domain has
to know about every such context.

**Considerations:**
- Only the process a suggestion belongs to knows when it applies: when to
  evaluate, when to evaluate again as the record changes, and when it stops
  applying.
- HL7 CDS Hooks has a service, called at a point in a workflow, return
  suggestions.
- A ruleset that finds things should be usable without suggestions — by a
  screen, a report, another service.
- Some suggestions have nothing else that would close them.

**Options:**
- **(A)** Decision support evaluates rules and expires suggestions by rules of
  its own. It would have to know every context, and a new mechanism to say
  which rules run when.
- **(B)** A service outside the contracts, triggered by events, evaluates the
  rules and creates the suggestions. Nothing in the contracts says what is
  suggested, and the mock has nothing to run it.
- **(C) ✓** The record that gives suggestions their context does it, from its
  own state machine: it evaluates the rules when its context begins and again
  as their inputs change, creates a suggestion for each finding, expires one
  whose finding has cleared, and expires the rest when its context ends. One
  nothing else closes expires at its expiry time, a day after it was proposed
  unless it says otherwise.

**Decision:** A ruleset flags records — each flag returns the ids of the records
it flags — and the state machine says which category each flag is suggested in.
See [From flags to suggestions](#from-flags-to-suggestions), and, for writing
the ruleset, [Rulesets that flag records](../../guides/rules-guide.md#rulesets-that-flag-records).

## From flags to suggestions

The state machine of the record that gives the suggestions their context — an
interview, say — evaluates the ruleset, binds each flag by name, and proposes a
suggestion for each flagged record, one line per flag:

```yaml
procedures:
  - id: suggestFlags
    steps:
      - evaluate: householdFlags
        inputs: { applicationId: $object.applicationId, current: $household }
        bind:
          elderly: elderlyWithoutMedicalCosts
          shortfall: incomeBelowExpenses
      - call: createSuggestions
        with: { category: elderly-without-medical-costs, subjectType: application_member, ids: $elderly }
      - call: createSuggestions
        with: { category: income-below-expenses, subjectType: application, ids: $shortfall }

  - id: createSuggestions
    parameters: [category, subjectType, ids]
    steps:
      - forEach: { in: $params.ids, as: id }
        do:
          - call: proposeSuggestion
            with: { category: $params.category, subjectType: $params.subjectType, id: $id }

  - id: proposeSuggestion
    parameters: [category, subjectType, id]
    steps:
      - call:
          operationId: createSuggestion
          requestBody:
            payload:
              kind: informing
              category: $params.category
              subjectType: $params.subjectType
              subjectId: $params.id
        catch: { do: [] }           # already open, or dismissed: nothing to do
```

- **It proposes through the operation**, so the API's checks apply as they
  would to a person proposing it: one already open, or dismissed, is refused
  with `409`, which `catch` ignores. It proposes as the system, the
  default, so it isn't held to the roles of whoever started the interview.
- **Each suggestion is proposed in a procedure of its own**, because a failed
  call ends the procedure it is in: one already open stops only its own
  proposal, not the rest of the list.
- **Bind each flag by name**, as above, rather than binding the whole result: a
  flag in a group has a dot in its name, which a `$result.name` lookup would
  split.
- **Evaluating again as the record changes** proposes nothing new for a flag
  still open, and nothing for one a person dismissed.
- **The harness's interview** (`blueprint-harness/contracts/domains/intake/intake-state-machine.yaml`)
  does all of this, and also expires a suggestion whose flag cleared and what's
  left open when it completes. It reads the household from the application's
  records with a call's `bind:`, and a flag that knows the corrected figure —
  income that differs from its pay stub — proposes the change itself, as an
  operation suggestion.

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

### When a suggestion expires

At its `expiresAt`: a day after it was proposed, unless it says otherwise. The
state machine sets the default (`$now+P1D`), so an overlay changes it by
replacing that value. Creating a suggestion asks the scheduler for a timer at
its `expiresAt`, and accepting, dismissing or expiring it cancels the timer; a
refused suggestion is still open, so its timer keeps running. A timer that
arrives after the suggestion was decided does nothing.

## Out of scope

- **Producing suggestions** — assistants, rules and extraction services propose
  them; see [AI Services](../cross-cutting/ai-services.md).
- **Reporting** — across records, from each domain's metrics.
- **The decision itself** — the person's, under the rules of the domain that
  owns the record; a suggestion only helps them make it.

## Capability coverage

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Suggestions a person accepts or dismisses | CDS Hooks cards and their suggestions | built |
| Recording acceptance and override with a reason | CDS Hooks feedback | built — each decision's event, and a dismissal's reason |
| Not repeating a suggestion open or dismissed | — | built |

## References

- [HL7 CDS Hooks](https://cds-hooks.hl7.org/)
- [AI Services](../cross-cutting/ai-services.md)
- [Platform](../cross-cutting/platform.md)
- [Communication](communication.md) — transcripts, which suggestions cite as evidence

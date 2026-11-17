# Template for scope.md

`scope.md` is read by two audiences: the developer, who must recognize it as their system, and the skill that builds the contracts from it. Keep the headings exactly as below so that skill can find each part.

- Use the developer's own words for things, and the blueprint's terms only for kinds of contract.
- Every item says why it's there: what the developer said, a regulation, or research. Cite sources as [field-knowledge.md](field-knowledge.md) says.
- Mark anything undecided as **Open**, with what each option would mean and the one you recommend. The build step uses the recommendation as a marked placeholder, so it can go ahead without the answer. Don't fill a gap with a guess.
- Leave out a subsection that doesn't apply instead of writing "none". Keep the ones the build step expects (marked *required*) even when short.
- Write for a policy analyst, not an engineer, as [architecture-docs.yaml](reference/docs/conventions/architecture-docs.yaml) asks. Stay at the level of shape: what each domain needs, not how its contracts are written.

How the build step uses each part:

| Section | Becomes |
|---|---|
| Domains | One architecture doc per domain, in the format of [architecture-docs.yaml](reference/docs/conventions/architecture-docs.yaml). The subsections here line up with its sections. |
| Connections | The commands, events and asynchronous requests between domains |
| Stories | Scenarios: walkthroughs that run as tests against the mock |
| Measures | The measures contracts, and the announcements each depends on |
| Decisions | Decision records in the architecture docs; open ones are asked before building |
| Gaps | What the build step tells the developer it won't produce |

````markdown
# Scope: {name}

Blueprint packages: {versions from versions.json}. Date: {date}.

## Overview *(required)*

{What it does, and for whom, in two or three sentences.}

**Implemented by:** {a workflow or rules engine configured to match / a simple backend / a mix / open}, as contract-driven-architecture.md's "Contracts as requirements" describes.

**Growing later:** {what might grow, such as more stores, more customer organizations or more programs, and whether to make room for it now. Making room now is usually cheap; adding it later means changing records already stored. Open, with a recommendation, if they don't know.}

### Who uses it *(required)*

| Who | Person or system | What they do with it | Kept as a record here? |
|---|---|---|---|

{Each kind of person becomes a role the contracts name when saying who may do what. Say whether the system keeps a record of them, like a driver it assigns work to, or only knows them when they act, like a customer placing an order.}

### Where each part sits *(required)*

| Part | Where it sits | Run by | Open? |
|---|---|---|---|
| {domain or part} | {one organization's own system / used by other organizations / run together / possibly run, owned or replaced by customers} | {who} | {Open: what each option would mean} |

### Map

{A diagram of the domains, the outside systems and the connections between them, in Mermaid. Color by [diagrams.yaml](reference/docs/conventions/diagrams.yaml): dark blue for this system's domains, yellow for outside and existing systems. Label each arrow with what passes along it and whether it's a command, an event or an asynchronous request.}

## Domains *(required)*

### {Domain name}

**Owns:** {what it's responsible for, in one paragraph: its records, what it produces, where its boundary sits, and why the boundary is there.}

**Shape:** {data-shaped | behavior-shaped}, because {what the developer said}.

**Kinds of contract:** *(required)*

| Kind | Why |
|---|---|
| {API and records / lifecycle / rules / events / composed view / adapter / configuration / overlay points / scenarios} | {what the developer said that calls for it, and the pattern from [shapes.md](shapes.md)} |

**Not needed:** {kinds considered and left out, and why, so nobody adds them by default.}

#### What happens

{Numbered steps of the work in this domain, in plain language, from the stories. No field, event or domain names. Cite regulations where they apply.}

#### Records

| Record | What it is | Exists on its own, or part of another? | Key facts it holds |
|---|---|---|---|

{Key facts: only what the stories and rules depend on, in plain words: amounts of money, places, who or what it belongs to, the choices it allows, and ids that belong to an outside system. Not a full list of fields.}

#### Stages

{For each record with a lifecycle. Columns follow architecture-docs.yaml's lifecycle section, so it carries over.}

| Stage | What it means | Processing clock (running, paused, stopped) |
|---|---|---|

**Key moves:** every move, including ones that don't change the stage (marking arrived) and ones the system makes on its own (assigning automatically).

| Move | From → to (or "stays") | Who or what makes it | If nobody does |
|---|---|---|---|

**Deadlines:**

| Deadline | Starts when | Stops or pauses when | How long (with source, or Open with a recommended default) | When it runs out |
|---|---|---|---|---|

#### Rules

| Rule | What it decides | When several qualify, which wins | Source | Changes by date or place? |
|---|---|---|---|---|

#### Calculations

{Anything worked out from other data, like an order's total. List these even when there are no policy rules: the blueprint can only add up or compare numbers inside a ruleset, so each one needs one.}

| Calculation | Worked out from |
|---|---|

#### Announces

{Only events with a real consumer, and a measure counts as one: list the events each measure below depends on. Say whether a choice travels as data on one event (ready, for pickup or delivery) or as separate events. Columns follow architecture-docs.yaml's event catalog.}

| What happens | Why it's needed | Triggered by | Who uses it |
|---|---|---|---|

#### Reacts to

| What happens elsewhere | What this domain does |
|---|---|

#### Measures

{What someone will want to count or time. Each is the time from one announcement to another, or a count of one, so its announcements must be listed above.}

| Measure | From what to what, or count of what | Target |
|---|---|---|

#### Outside systems

| System | What it provides | Run by | Answers right away? |
|---|---|---|---|

#### Customization

**Configuration:** what each organization sets up ahead of time.

| Setting | Default | Who sets it |
|---|---|---|

**Overlay points:** {parts others might adapt, and what they might change. Only when someone might.}

**Must stay the same:** {architecture-docs.yaml's baseline constraints.}

| Element | Reason (cite the regulation or name the dependency) | Decision |
|---|---|---|

#### Out of scope

{What a reader might assume this domain does, and where that actually lives.}

## Connections *(required)*

| From | To | What passes | Kind | Why |
|---|---|---|---|---|
| {domain} | {domain or outside system} | {plain words} | {command / domain event / async command / cross-domain seeding} | {the reason, by inter-domain-communication.md's decision rule} |

## Stories *(required)*

{The cases walked through in the conversation. Each becomes a scenario that runs against the mock, so write each one start to finish, with who does what at every step. Include the cases that fail, take too long, or need an exception.}

### {Story name}

**Who:** {the people and systems in it}

**Starts from:** {nothing, or what already exists when the story begins, like an order already being prepared}

**Outside systems answer:** {what each outside system says in this story, including a decline or no answer}

1. {Who does what.}
2. {What happens next.}

**Ends with:** {how things stand when it's over.}

## Decisions *(required)*

{One subsection per decision, in the format [architecture-docs.yaml](reference/docs/conventions/architecture-docs.yaml) uses for decision records, so it carries into the architecture docs unchanged.}

### {Decision title}

**Status:** {Decided: B | Open}

**What's being decided:** {the problem forcing the decision, then what's being chosen.}

**Considerations:** {2–4 bullets, including what the prior art does and the regulations involved.}

**Options:**
- (A) {option}
- (B) {option} ✓
- (C) {option}

## Prior art *(required)*

{Standards and existing designs found, and how this design relates to each: follows it, differs from it and why, or nothing found and what was searched. The regulations that apply. Each with its source. Anything with no standard or prior art is marked invented, with why, as standards.yaml's `order_of_preference` requires.}

### Capability coverage

{What established systems of this kind offer, and whether this design covers it, in architecture-docs.yaml's capability coverage format. Name the systems compared against.}

| Capability | Industry standard | Status (planned / partial / not in scope, with reason / adapter layer / gap) |
|---|---|---|

## Gaps *(required)*

| Gap | What the developer will do about it |
|---|---|

## Built on

{Only if the developer chose to build on someone else's contracts, such as the safety-net contracts: which ones, whether copying a pattern or building on them, and what that means for taking their updates.}

## Sources *(required)*

{Every source cited above, with links. List claims labeled "general knowledge, check this" here too, so someone can check them.}
````

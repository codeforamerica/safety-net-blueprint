# Prior art first

Don't sketch a design from scratch when someone has already designed this kind of system. As soon as you know what the developer wants to build and for whom, and before walking through the story, find what exists. Then the sketch starts from what others do, and anything new is a choice made on purpose. The order is the blueprint's: [standards.yaml](reference/docs/conventions/standards.yaml) (`order_of_preference`) says to use an adopted standard, then borrow from prior art and name the source, and invent only when neither fits, saying so. [architecture-philosophy.md](reference/docs/architecture/architecture-philosophy.md) §6 gives the reason: before designing something, ask whether something that solves the problem already exists and has traction. What this file adds is when to look and how to use what you find.

## When

- **Before the story:** a first pass on the subject as a whole, right after the developer says what they want to build and for whom.
- **During the story:** a narrower pass whenever a new part comes up, such as an outside system, a regulated decision, or a kind of record you haven't looked into.
- **Before recommending something with no prior art:** look once more, then say it's invented and why nothing fit.

## What to look for

In this order, citing each finding with its link and the date you found it:

1. **Standards.** Check [standards.yaml](reference/docs/conventions/standards.yaml) first, then look for data or API standards for this kind of system: industry data formats, government data standards, API specifications that others implement.
2. **Designs that already exist.** How others built this kind of system: products and their published APIs, open-source projects, government systems with public documentation. Look at their architecture, not their features:
   - what records they keep and how they split them up
   - what stages those records go through
   - what they decide by rule
   - what they announce, and to whom
   - what they connect to
3. **The blueprint's own research,** when the subject is near public benefits (below).
4. **What established systems offer:** the capabilities systems of this kind provide, for the scope's capability coverage table ([architecture-docs.yaml](reference/docs/conventions/architecture-docs.yaml), `capability_coverage`).
5. **Rules:** the laws and regulations that apply, from the source itself or the body that issues it, not a summary. When someone other than the customer runs it, research the rules for the operator separately from the rules for its customers.

## Bring it to the developer before the story

Give a short summary of what you found before asking for the story:
- what the main designs have in common;
- where they differ;
- any standard that applies.

Its form, with the facts coming from your research, each with its source: "The {three} {products or systems} I found all {split it this way}, {handle this the same way}, and {require this}. They differ on {this}. {This standard} covers {this part}."

Ask whether they know of others, or have reasons to differ. Then use the prior art throughout the conversation:

- **In the sketch:** start from the common design, and say where it came from.
- **As probes:** "Everyone I found does X; will yours?" Steps, rules and decisions the developer didn't mention are the most useful finds.
- **In decisions:** following the common design is usually one of the options; departing from it needs a reason.

If you find no prior art, say so, and say what you searched.

## The blueprint's research, when the subject is near public benefits

The blueprint's domain docs are research on public benefits: intake, eligibility, case management, outside data sources and the rest, in [reference/docs/architecture/domains/](reference/docs/architecture/domains/). Read them when what the developer described is benefits work or close to it, such as other government services that take applications, check information against outside sources, or manage cases. Skip them when it isn't.

Notice which side the developer is on. If they're building something benefits agencies use from outside, the domain docs describe their customers: read them for what those customers will expect, not as the shape of the developer's system.

Use them as knowledge, not as contracts: what they found applies whether or not the developer builds on the safety-net contracts. Start with [domain-design.md](reference/docs/architecture/domains/domain-design.md), which lists every domain and what each owns, then read the ones that touch what the developer described. The sections that help most:

- **What happens during …**: the steps of the work. Compare them with what the developer described.
- **Regulatory requirements**: rules the developer may not have mentioned.
- **Key design decisions**: choices already researched, with the options and how vendors do it.
- **Out of scope** and **Known gaps**: where the research stopped.

For example, for a system that checks information against outside sources, data-exchange covers how agencies reach those sources and the rules on using them.

Several domains are partial or not started. domain-design.md's status table is out of date, so judge from the domain's own doc, and say so when you rely on an unfinished one.

## Say where each thing came from

In what you tell the developer and in `scope.md`, each claim is one of:

- **From the blueprint:** name the doc.
- **From research:** give the link.
- **General knowledge, check this:** what you know without a source. Label it, and don't build a recommendation on it alone.

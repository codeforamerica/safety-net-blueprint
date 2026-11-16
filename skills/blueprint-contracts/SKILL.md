---
name: blueprint-contracts
description: Use before building anything with the Code for America blueprint (the @codeforamerica/blueprint-* packages), when a developer says what they want to build — a service, an API, a capability, a product — or doesn't know where to start. Works out with them what they're building and which blueprint contracts it needs, writes that down as a scope they agree to, then builds the contracts, scenarios that run on the mock, and the explorer's pages from it.
allowed-tools: Read, Glob, Grep, WebSearch, WebFetch, Write, Edit, Bash(npm:*), Bash(npx:*), Bash(node:*)
---

# Build contracts with the blueprint

This skill takes a developer from an idea to blueprint contracts for any kind of backend, not only public benefits. It works in steps. Each step's instructions are in their own file; read only the one for the step you're on.

## Which step

| When | Step |
|---|---|
| The project has no `scope.md` | [Scope](step-scope.md): work out with the developer what they're building and which contracts it needs, and write `scope.md` |
| There's a `scope.md` the developer agreed to, and no contracts yet | [Build](step-build.md): turn the scope into contracts, scenarios that pass on the mock, and the explorer's pages |

## Rules for every step

- **The blueprint's method, not yours.** The architecture comes from the blueprint's own docs: [architecture-philosophy.md](reference/docs/architecture/architecture-philosophy.md), [architecture-patterns.md](reference/docs/architecture/architecture-patterns.md), [contract-driven-architecture.md](reference/docs/architecture/contract-driven-architecture.md), [inter-domain-communication.md](reference/docs/architecture/inter-domain-communication.md), [standards.yaml](reference/docs/conventions/standards.yaml) and [architecture-docs.yaml](reference/docs/conventions/architecture-docs.yaml). This skill's files say when to apply them and point to them; where a file and a doc disagree, the doc wins.
- **Standards, then prior art, then invention,** in that order, as standards.yaml says. Mark anything invented, and say why nothing existing fit.
- **Any kind of system.** The framework is for any backend, not only public benefits. Don't steer a developer toward benefits concepts or the safety-net contracts when their subject isn't that.
- **Framework first.** The safety-net contracts (`@codeforamerica/blueprint-safety-net-contracts`) are one reference implementation built on the framework, and they're still changing. Their domain docs are research on how benefits work is done; their contracts are offered only where one of their domains already models part of what the developer described ([shapes.md](shapes.md), section 7). Never assume them.
- **Say where each claim comes from:** the blueprint's docs, research with a link, or general knowledge labeled "check this" ([field-knowledge.md](field-knowledge.md)). A recommendation needs more than general knowledge behind it.
- **The smallest architecture that fits.** Only the domains and kinds of contract the story calls for. A data-shaped system needs only an API contract; say so.
- **Keep replies short.** A conversation, not a report: a few points and one or two questions at a time, in about a screen. Summarize research in a few lines and offer more. The full detail belongs in the files the step writes.
- **Ask, don't decide.** Decisions about what the system does belong to the developer. Undecided is a valid answer; keep the options open.
- **Versions.** The reference docs match the package versions in [versions.json](versions.json). If the developer's project already has blueprint packages at other versions, say so, since the docs may not match.

The bundled docs are listed in [reference/INDEX.md](reference/INDEX.md). Read one when a step names it, not all of them up front.

#!/usr/bin/env node
/**
 * Wrapper around `npx changeset` that prints authoring guidance before
 * opening the interactive CLI.
 */

import { execSync } from 'child_process';

console.log(`
┌─────────────────────────────────────────────────────────────────┐
│  Adding a changeset                                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  The summary you write becomes the CHANGELOG entry.             │
│  Write it for someone reading the changelog, not the PR.        │
│                                                                 │
│  ✓  Name what a consumer would see — a different return         │
│     value, a flag that works, an error they used to get.        │
│     If you cannot name one, skip the changeset.                 │
│  ✓  One or two sentences, from the consumer's perspective       │
│  ✓  Say what you had to do before, and what you can do now      │
│  ✓  Include the issue number at the end if there is one         │
│  ✗  Don't describe what files changed                           │
│  ✗  No "rather than X" clauses — that is arguing, not telling   │
│  ✗  No sizes or counts; those belong in the README or the PR    │
│                                                                 │
│  Examples:                                                      │
│    Before, a metric counting anything other than tasks or       │
│    events got a 500 from the metrics endpoint. Now the          │
│    collections come from the metric definitions. (#123)         │
│                                                                 │
│    Before, booting the mock server meant pointing it at a       │
│    contracts directory. Now blueprint-bundle-contracts writes   │
│    the set to one JSON file it can boot from. (#456)            │
│                                                                 │
│  Breaking changes (minor bump):                                 │
│    **Breaking:** blueprint-scaffold-api no longer accepts       │
│    --template — use --domain instead. (#456)                    │
│                                                                 │
│  Bump type guide:                                               │
│    patch  — bug fix, no behavior change for consumers           │
│    minor  — new feature or breaking change (we're at 0.x)       │
│    major  — reserved for 1.0.0 declaration                      │
│                                                                 │
│  See CONTRIBUTING.md for full guidance.                         │
└─────────────────────────────────────────────────────────────────┘
`);

execSync('npx changeset', { stdio: 'inherit' });

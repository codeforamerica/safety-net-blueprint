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
│  The summary you write becomes the CHANGELOG entry.            │
│  Write it for someone reading the changelog, not the PR.       │
│                                                                 │
│  ✓  Complete sentence from the consumer's perspective          │
│  ✓  Include the issue number at the end if there is one        │
│  ✗  Don't describe what files changed                          │
│                                                                 │
│  Examples:                                                      │
│    Overlay resolution now handles circular $ref chains         │
│    without throwing. (#123)                                     │
│                                                                 │
│    blueprint-scaffold-api now accepts --domain to set the      │
│    x-domain field in the generated spec. (#456)                │
│                                                                 │
│  Breaking changes (minor bump):                                 │
│    **Breaking:** blueprint-scaffold-api no longer accepts      │
│    --template — use --domain instead. (#456)                   │
│                                                                 │
│  Bump type guide:                                               │
│    patch  — bug fix, no behavior change for consumers          │
│    minor  — new feature or breaking change (we're at 0.x)      │
│    major  — reserved for 1.0.0 declaration                     │
│                                                                 │
│  See CONTRIBUTING.md for full guidance.                        │
└─────────────────────────────────────────────────────────────────┘
`);

execSync('npx changeset', { stdio: 'inherit' });

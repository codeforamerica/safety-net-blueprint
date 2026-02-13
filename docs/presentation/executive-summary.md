# Safety Net Blueprint
## Executive Summary

### The Problem

Building technology for safety net programs is challenging. Each state has different terminology, program names, and requirements. Development teams waste time reinventing solutions, integration between systems is slow and error-prone, and organizations often become locked into specific vendors' proprietary systems.

### The Solution

The Safety Net Blueprint provides **a shared systems integration blueprint for benefits eligibility programs** — covering data models, APIs, and operational behavior. Instead of starting from scratch, teams build on a common foundation that captures core concepts — applications, households, income, eligibility, task routing, SLA tracking — while allowing for state-specific customization.

### Key Capabilities

- **Shared API Definitions** — Ready-to-use specifications for common benefits data, built on industry standards that any vendor can implement
- **Workflow & Business Rules** — Your rules for processing benefits — deadlines, task routing, approval workflows — captured in portable files your state owns, not locked inside a vendor's system
- **Vendor Portability** — Switch backend or frontend vendors without losing your business rules, state customizations, or the applications your teams have built
- **Simulated APIs** — Fully functional test environments generated automatically, enabling frontend development without waiting for backend systems
- **Ready-to-Use Code Libraries** — Pre-built integration code that catches errors early and speeds up development
- **State Customizations** — Adapt the shared definitions for each state's terminology and requirements without duplicating work
- **One-Command API Creation** — Define a new data type once, and automatically get a complete API with documentation, test environment, and code libraries

### Benefits

| For | Value |
|-----|-------|
| **Development Teams** | Start building immediately; consistent patterns reduce bugs and ramp-up time |
| **Program Managers** | Faster delivery; reduced coordination overhead between teams |
| **States & Agencies** | Customizable for local requirements; business rules and apps are portable across vendor transitions |

### How It Works

1. Teams start with pre-built definitions for common benefits data and operational workflows
2. State-specific customizations adapt terminology, requirements, and business rules
3. Documentation, test environments, and code libraries are generated automatically
4. Backend teams implement against clear specifications with automated verification
5. Improvements to the shared foundation benefit all participating states
6. When vendors change, your rules, customizations, and frontends carry over — only the connection to the vendor's system is replaced

### Get Started

Visit the [Toolkit Overview presentation](https://codeforamerica.github.io/safety-net-blueprint/docs/presentation/safety-net-openapi-overview.html) for a detailed walkthrough, explore the [ORCA Data Explorer](https://codeforamerica.github.io/safety-net-blueprint/docs/schema-reference.html) to see the data model, or visit the [repository on GitHub](https://github.com/codeforamerica/safety-net-blueprint).

---

*Code for America — A systems integration blueprint for safety net programs.*

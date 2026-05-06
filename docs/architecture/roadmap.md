# Roadmap

> **Status: Active development**

See also: [Contract-Driven Architecture](contract-driven-architecture.md) | [Domain Design](domain-design.md) | [API Architecture](api-architecture.md) | [Design Rationale](design-rationale.md)

---

## Phases

### Phase 1: Overlay system (complete)

Proved that states can customize the base contracts without forking. States apply overlay files that add, replace, or extend base definitions — the resolve pipeline merges overlays at build time and produces state-specific resolved specs. All downstream tooling (mock server, client generation, Postman) runs against the resolved output.

**What this proves:** A single base contract can serve multiple states with different program names, field requirements, and business rules — without duplicating or diverging the base.

### Phase 2: Behavioral contracts (complete)

Proved that system behaviors can be defined declaratively in contract artifacts and interpreted at runtime without hand-written orchestration code. The workflow domain — state machine, decision rules, metrics, and SLA types — drives the mock server's behavioral engine: transitions enforce guards, effects fire automatically, and RPC endpoints are generated from state machine triggers.

**What this proves:** State machines, rules, and metrics authored in YAML tables are sufficient to define and run complex task lifecycle behavior. Business users can read and modify the artifacts without developer involvement.

### Phase 3: Intake steel thread — Application Submission (current)

Build out the Application Submission flow end to end, following the flow defined in the [context map](../../packages/explorer/context-map/output/context-map.html). Every domain the flow touches gets the contract surface needed to support it.

**What this proves:** Event-driven architecture across domain boundaries (submission fans out in parallel to workflow, eligibility, and client management) and the data exchange architecture (async verification calls to FDSH, IEVS, SAVE, SSA with results returned as events).

**Scope:**
- Verification entity — per-program, per-member verification tracking with electronic evidence (#248)
- Data Exchange contract surface — service call lifecycle for federal verification services
- Eligibility pre-screening surface — expedited screening and Medicaid RTE
- Client Management — person matching API surface (#249)

### Phase 4: Intake steel thread — Caseworker Review

Build out the Caseworker Review flow: task claim through interview to all verifications resolved.

**What this proves:** Field annotations and permissions as contract artifacts driving context-dependent UI (what the caseworker sees on a verification item depends on its program, status, and evidence); the application object model under active caseworker work.

**Scope:**
- Application model updates — annotations and possible field-level annotations driven by program and verification context
- Scheduling integration — appointment scheduling and interview tracking linked to the application
- Document management surface — evidence attachment to verification items
- Verification resolution and retry — caseworker review, document upload, retriable failure handling

### Phase 5: Intake steel thread — Eligibility Determination

Build out the Eligibility Determination flow: both auto (Medicaid-only, conclusive at submission) and manual (SNAP, and Medicaid when checks are inconclusive) paths through determination, notice, and case creation.

**What this proves:** Eligibility contract surface for receiving determination results and closing the application; supervisor review and escalation of tasks before a determination is finalized.

**Scope:**
- Eligibility determination rules surface — receiving and recording per-person, per-program results
- Communications surface — Notice of Action on determination
- Case creation — application closure triggering case management

### Phase 6+: Remaining domains

Design and implement remaining domains based on priorities at that time. Domains not yet started include: client management (full build-out), document management, communications, appeals and hearings, benefits and payments.

H.R. 1 compliance deadlines (SNAP work requirement changes effective 2025, Medicaid community engagement requirements effective December 2026) are likely to influence sequencing — states need portable, table-driven contract changes to respond to policy shifts without rebuilding their systems.

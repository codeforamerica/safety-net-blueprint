# Roadmap

> **Status: Work in progress**

See also: [Contract-Driven Architecture](contract-driven-architecture.md) | [Domain Design](domain-design.md) | [API Architecture](api-architecture.md) | [Design Rationale](design-rationale.md)

---

## Context: H.R. 1 (One Big Beautiful Bill Act)

H.R. 1, signed into law in mid-2025, introduces significant changes to safety net programs that directly affect the domains this project is designing. These changes increase the urgency of having portable, contract-driven systems that states can adapt quickly.

**SNAP changes (effective 2025):**
- Work requirements expanded to ages 18–65 (previously 18–49 for ABAWDs), requiring 80 hours/month of work, volunteering, or training
- Noncitizen eligibility narrowed to LPRs, Cuban-Haitian entrants, and COFA migrants
- State cost-sharing starting 2028 for states with payment error rates above 6%

**Medicaid changes (effective December 31, 2026):**
- Work/community engagement requirements for enrollees ages 19–64 (80 hours/month), with exemptions for parents of dependents under 13, pregnant/postpartum women, and medically frail individuals
- Eligibility redetermination every 6 months (from 12) for expansion population adults without disabilities
- Noncitizen eligibility narrowed (effective October 2026)

**Impact on state systems:**
- States must update integrated eligibility and enrollment (IEE) systems before compliance dates
- Significant IT system changes needed — some states estimating hundreds of new positions for more frequent redeterminations
- States are deprioritizing previously planned enhancements to focus on H.R. 1 compliance

**Relevance to this project:**
- Work requirement tracking affects Workflow (new task types), Eligibility (new verification requirements), and Case Management (more frequent reviews)
- More frequent redeterminations increase the volume and complexity of Eligibility and Intake workflows
- Narrowed immigrant eligibility adds verification complexity to Intake and Eligibility
- The contract-driven approach — where adding a requirement is a table change, not a code change — is exactly what states need to respond to these kinds of policy shifts without rebuilding their systems

---

## Approach

The architecture is being proven through **steel thread prototypes** — the thinnest end-to-end slices that exercise the most complex and risky parts of the [contract-driven architecture](contract-driven-architecture.md). The goal is to validate that:

1. **Behavioral contracts work** — State machines, rules, and metrics can be defined declaratively and interpreted by a mock server, generating RPC endpoints from transitions without hand-written orchestration code.
2. **The authoring pipeline works** — Business users and developers can author contracts in tables (spreadsheets), and conversion scripts generate valid YAML. The tables-to-YAML-to-mock-server chain works end to end.
3. **Business users can work with the artifacts** — The table-based authoring format is accessible to program managers, policy analysts, and business analysts — not just developers. If business users can't read and modify state transition tables, decision tables, and form definition tables, the architecture fails regardless of technical correctness.
4. **Form definitions drive context-dependent UI** — The frontend can render multi-program forms from declarative definitions without hardcoding domain-specific logic.

Two prototypes cover every contract artifact type between them:

| Prototype | What it proves | Key artifacts |
|-----------|---------------|---------------|
| [Workflow Prototype](../prototypes/workflow-prototype.md) | Behavioral contracts — state machine, rules, metrics, audit | OpenAPI schemas, state machine YAML, rules YAML, metrics YAML |
| [Application Review Prototype](../prototypes/application-review-prototype.md) | Form definitions — program-driven sections, field annotations, record creation | OpenAPI schemas, form definition YAML |

They can be done in either order. Together they prove the full artifact set before any domain is built out at scale.

---

## Phases

### Phase 1: Prove the architecture (current)

Build and validate the two steel thread prototypes. This is where the highest-risk design questions get answered.

#### Tooling priorities

The prototypes require new tooling and updates to existing tooling. This is the foundation — the prototypes can't run without it.

**Conversion scripts (new)** — translate from the table-based authoring format to YAML contract definitions:
- State machine tables → state machine YAML (states, transitions, guards, effects)
- Decision tables → rules YAML (routing, assignment, priority)
- Metrics tables → metrics YAML (metric names, source linkage, targets)
- Form definition tables → form definition YAML (sections, fields, annotations, program requirements)

**Validation scripts (update existing + new)** — extend `npm run validate` to check cross-artifact consistency:
- State machine states match OpenAPI status enums
- Effect targets reference schemas that exist
- Rule context variables resolve to real fields
- Form definition field source paths resolve to OpenAPI schema fields
- Transitions include required audit effects
- Metric sources reference states/transitions that exist

**Mock server (update)** — add a behavioral engine that interprets contract YAML alongside the existing CRUD engine:
- Load state machine YAML and auto-generate RPC endpoints from triggers
- Enforce state transitions and evaluate guards on RPC calls
- Execute effects (set fields, create records, lookup references, evaluate rules, emit events)
- Evaluate decision rules for routing, assignment, and priority
- Track metrics linked to states and transitions
- Serve form definitions and create work item records from program requirements

#### Prototype deliverables

**Workflow prototype:**
- Conversion scripts generate state machine, rules, and metrics YAML from authored tables
- Validation script catches cross-artifact inconsistencies
- Mock server runs the full workflow walkthrough (create → route → claim → complete) without hand-written endpoint code
- Minimal frontend exercises every API type (REST reads, RPC actions, SSE events)
- Business users review the authoring tables for clarity and usability

**Application review prototype:**
- Conversion scripts generate form definition YAML from authored tables
- Validation script catches internal inconsistencies (field source paths → OpenAPI schemas, section IDs match between program requirements and section definitions)
- Mock server serves form definitions and creates SectionReview records from program requirements on submission
- Minimal frontend renders context-dependent sections and field annotations from the form definition
- Business users review program requirements and field annotation tables

**What success looks like:**
- Conversion scripts generate valid YAML from authored tables
- Validation catches structural inconsistencies (missing states, dangling references, unresolvable field paths)
- Mock server runs the full walkthrough for both prototypes without hand-written endpoint code
- Business stakeholders can read the tables, understand what they mean, and propose changes

### Phase 2: Expand proven domains

With the architecture validated, expand the domains that were started in the prototypes.

- **Workflow** — Add remaining states and transitions (escalate, reassign, cancel, awaiting states), verification workflow, cross-domain rule context, notification effects, full SLA configuration
- **Intake** — Add additional sections (assets, expenses, employment), additional programs (TANF, WIC, CHIP), conditional section requirements, applicant-facing forms
- **Case Management** — Define contract artifacts (OpenAPI spec, case lifecycle state machine, assignment rules)
- **Communication** — Define contract artifacts (notice lifecycle state machine, delivery tracking)

### Phase 3: Remaining domains

- **Eligibility** — Domain design and contract artifacts (eligibility request lifecycle, determination, verification requirements)
- **Client Management** — OpenAPI spec for persistent client identity and relationships
- **Scheduling** — Appointments and interviews
- **Document Management** — Files and uploads

---

## Future Considerations

Potential domains and functionality not included in the current design, for future evaluation.

### High Priority

**Benefits/Issuance**
- Benefit amounts and calculations, EBT card issuance, payment tracking, benefit history
- Core to safety net programs — what happens after eligibility is determined

**Appeals**
- Appeal requests, fair hearing scheduling, hearing outcomes
- Required by law for all programs, with distinct workflow, timelines, and participants

### Medium Priority

**Change Reporting**
- Mid-certification changes reported by clients, impact assessment on current benefits
- Common client interaction between certifications, related to but distinct from Intake

**Programs**
- Program definitions, eligibility rules, income/asset limits, deduction rules
- Reference data needed across all domains — could be configuration vs. a domain

### Low Priority

**Fraud/Integrity** — Investigations, overpayment tracking, recovery, IPVs, disqualification periods

**Referrals** — Referrals to other services, partner agency connections, community resource linking

**Provider Management** — Healthcare providers (Medicaid), SNAP retailers, TANF service providers

**Quality Assurance** — Case reviews, error tracking, corrective action plans, federal reporting metrics

**Staffing Forecasting** — Project task volume, calculate required staff hours, identify staffing gaps

---

## Documentation Gaps

### Needs architecture documentation

**Data Retention & Archival**

| Data Type | Active Retention | Archive | Purge |
|-----------|------------------|---------|-------|
| Applications | 7 years after closure | Cold storage | Per state policy |
| Audit logs | 7 years | Immutable archive | Never (compliance) |
| PII | Per program requirements | Encrypted archive | On request + retention period |
| Session/tokens | 24 hours | N/A | Immediate |

Compliance cross-references: SNAP (7 CFR 272.1), Medicaid (42 CFR 431.17), TANF (45 CFR 265.2), HIPAA, FERPA. See also [API Architecture - Compliance](api-architecture.md#compliance).

**Event-Driven Architecture**

Events published to a message broker for external system integration. Event payload schemas are defined as contract artifacts (e.g., `TaskClaimedEvent` in the workflow prototype). Webhook subscriptions, delivery guarantees, and event versioning need further design.

**Integration Patterns**

How legacy systems and external services connect — API gateway, adapter pattern, anti-corruption layer, event bridge, batch file exchange. The [contract-driven architecture](contract-driven-architecture.md) defines the adapter pattern; other integration patterns need further documentation.

### Separate documents (future)

**Testing Strategy** — Contract testing, mock server usage patterns, integration test data management, performance testing approach

**State Security Implementation Guide** — Identity provider setup, role mapping, break-glass procedures, compliance documentation (FedRAMP, StateRAMP)

# Communications (Cross-Cutting)

> **Status: Work in progress** — Architecture decided. Contract artifacts TBD.

See [Domain Design Overview](../domain-design.md) for context and [Contract-Driven Architecture](../contract-driven-architecture.md) for the contract approach.

## Overview

Communications is cross-cutting because notices and correspondence can originate from any domain:
- **Intake**: "Application received"
- **Eligibility**: "Approved", "Denied", "Request for information"
- **Workflow**: "Documents needed", "Interview scheduled"
- **Case Management**: "Case worker assigned"

This maps to what IBM Curam calls **Communications Management** and the broader industry category of **Customer Communication Management (CCM)** — vendors like OpenText and Quadient serve this space. It covers both regulated client-facing correspondence (Notices of Action, eligibility letters) and internal operational alerts (supervisor escalation notifications, SLA warnings).

## Event-driven trigger model

Communications are triggered by domain events — not by direct calls from other domains or `notify` effects embedded in state machine transitions. When a workflow transition fires (e.g., `escalated`), it emits a domain event. The communications domain subscribes to those events and evaluates its own notification rules to determine what to send, to whom, and via which channel.

This keeps each domain's contracts clean:
- Workflow defines *what happened* (state transitions, events)
- Communications defines *what to communicate* as a result (notification rules, templates, channels)

States override communication behavior via overlay — swapping templates, adjusting recipients, suppressing or adding rules — without touching workflow contracts.

## Notification rules contract

Communication behavior is declared in a `communications-rules.yaml` (analogous to `workflow-rules.yaml`), evaluated by the communications rule engine when a subscribed event fires:

```yaml
# communications-rules.yaml (illustrative — schema TBD)
domain: communications
rules:
  - id: escalation_alert
    on:
      domain: workflow
      action: escalated
    notify:
      template: task_escalated
      recipients:
        - role:supervisor
  - id: review_request
    on:
      domain: workflow
      action: submitted_for_review
    notify:
      template: task_pending_review
      recipients:
        - role:supervisor
  - id: awaiting_client_notice
    on:
      domain: workflow
      action: awaiting_client
    notify:
      template: client_action_required
      recipients:
        - $object.clientId
      channel: email
```

Recipients support: `$caller`, `$object.<field>`, `role:<name>` (all users with a given role).

## Entities

| Entity | Purpose |
|--------|---------|
| **Notice** | Official regulated communication (approval, denial, RFI, NOA) |
| **Correspondence** | Other communications (client inquiries, worker notes, inter-agency) |
| **DeliveryRecord** | Tracking of delivery status across channels |

## Contract Artifacts

| Artifact | Status | Notes |
|----------|--------|-------|
| OpenAPI spec | TBD | REST APIs for notices, correspondence, and delivery records |
| State machine YAML | TBD | Notice lifecycle — states, transitions, guards (e.g., supervisor approval before send), effects (e.g., initiate delivery, audit event) |
| Notification rules YAML | TBD | Event subscriptions → notify rules (template, recipients, channel) |
| Metrics YAML | TBD | Delivery success rates, time-to-send, failed delivery tracking |

## Open design questions

- **Notice lifecycle** — What states and transitions does a Notice go through? Which require supervisor approval before sending?
- **Delivery channels** — How are multiple delivery methods (postal, email, portal) modeled? Per-notice or per-DeliveryRecord?
- **Template system** — How do notice templates reference field values from the originating domain?
- **Retry behavior** — How are failed deliveries retried? Automatic via state machine timeout, or manual RPC?
- **Schema** — Define the `communications-rules.yaml` schema (`$schema`, `on`, `notify`, recipient expressions, channel enum).

## Related Documents

| Document | Description |
|----------|-------------|
| [Domain Design](../domain-design.md) | Communications section in the domain overview |
| [Contract-Driven Architecture](../contract-driven-architecture.md) | Contract artifacts and the adapter pattern |

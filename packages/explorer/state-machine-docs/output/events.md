# Published Events

Auto-generated from state machine `emit` and subscription declarations.

| Event | Published by | Subscribers |
|---|---|---|
| `data_exchange.call.completed` | *(unknown)* | [Eligibility/Decision](eligibility.md#decision), [Intake/Application](intake.md#application) |
| `document_management.version.uploaded` | *(unknown)* | [Intake/Application](intake.md#application) |
| `eligibility.application.all_determined` | *(unknown)* | [Intake/Application](intake.md#application) |
| `eligibility.application.decision_completed` | *(unknown)* | [Eligibility/Determination](eligibility.md#determination) |
| `eligibility.application.determination_completed` | *(unknown)* | [Intake/Application](intake.md#application) |
| `eligibility.application.expedited` | *(unknown)* | [Intake/Application](intake.md#application) |
| `eligibility.decision.created` | *(unknown)* | [Eligibility/Decision](eligibility.md#decision) |
| `eligibility.decision.decision_completed` | [Eligibility/Decision](eligibility.md#decision) | *(none)* |
| `eligibility.determination.created` | *(unknown)* | [Eligibility/Determination](eligibility.md#determination) |
| `eligibility.determination.determination_completed` | [Eligibility/Determination](eligibility.md#determination) | *(none)* |
| `eligibility.determination.expedited` | [Eligibility/Determination](eligibility.md#determination) | *(none)* |
| `eligibility.determination.withdrawn` | [Eligibility/Determination](eligibility.md#determination) | *(none)* |
| `intake.application.closed` | [Intake/Application](intake.md#application) | *(none)* |
| `intake.application.expedited_flagged` | [Intake/Application](intake.md#application) | *(none)* |
| `intake.application.opened` | [Intake/Application](intake.md#application) | *(none)* |
| `intake.application.review_completed` | [Intake/Application](intake.md#application) | [Eligibility/Determination](eligibility.md#determination) |
| `intake.application.submitted` | [Intake/Application](intake.md#application) | [Eligibility/Determination](eligibility.md#determination), [Intake/Application](intake.md#application), [Workflow/Task](workflow.md) |
| `intake.application.withdrawn` | [Intake/Application](intake.md#application) | [Eligibility/Determination](eligibility.md#determination) |
| `intake.verification.created` | *(unknown)* | [Intake/Verification](intake.md#verification) |
| `intake.verification.inconclusive` | [Intake/Verification](intake.md#verification) | *(none)* |
| `intake.verification.satisfied` | [Intake/Verification](intake.md#verification) | *(none)* |
| `intake.verification.waived` | [Intake/Verification](intake.md#verification) | *(none)* |
| `scheduling.appointment.scheduled` | *(unknown)* | [Intake/Application](intake.md#application) |
| `workflow.client_timeout` | *(unknown)* | [Workflow/Task](workflow.md) |
| `workflow.creation_deadline` | *(unknown)* | [Workflow/Task](workflow.md) |
| `workflow.sla_breach` | *(unknown)* | [Workflow/Task](workflow.md) |
| `workflow.sla_warning` | *(unknown)* | [Workflow/Task](workflow.md) |
| `workflow.task.approved` | [Workflow/Task](workflow.md) | *(none)* |
| `workflow.task.assigned` | [Workflow/Task](workflow.md) | *(none)* |
| `workflow.task.auto_cancelled` | [Workflow/Task](workflow.md) | *(none)* |
| `workflow.task.auto_escalated` | [Workflow/Task](workflow.md) | *(none)* |
| `workflow.task.awaiting_client` | [Workflow/Task](workflow.md) | *(none)* |
| `workflow.task.awaiting_verification` | [Workflow/Task](workflow.md) | *(none)* |
| `workflow.task.cancelled` | [Workflow/Task](workflow.md) | *(none)* |
| `workflow.task.claimed` | [Workflow/Task](workflow.md) | [Intake/Application](intake.md#application) |
| `workflow.task.completed` | [Workflow/Task](workflow.md) | *(none)* |
| `workflow.task.created` | *(unknown)* | [Workflow/Task](workflow.md) |
| `workflow.task.de-escalated` | [Workflow/Task](workflow.md) | *(none)* |
| `workflow.task.escalated` | [Workflow/Task](workflow.md) | *(none)* |
| `workflow.task.priority_changed` | [Workflow/Task](workflow.md) | *(none)* |
| `workflow.task.released` | [Workflow/Task](workflow.md) | *(none)* |
| `workflow.task.reopened` | [Workflow/Task](workflow.md) | *(none)* |
| `workflow.task.resumed` | [Workflow/Task](workflow.md) | *(none)* |
| `workflow.task.returned_to_worker` | [Workflow/Task](workflow.md) | *(none)* |
| `workflow.task.sla_breached` | [Workflow/Task](workflow.md) | *(none)* |
| `workflow.task.submitted_for_review` | [Workflow/Task](workflow.md) | *(none)* |
| `workflow.task.system_resumed` | [Workflow/Task](workflow.md) | *(none)* |
| `workflow.task.updated` | *(unknown)* | [Workflow/Task](workflow.md) |
| `workflow.verification_timeout` | *(unknown)* | [Workflow/Task](workflow.md) |

## Subscribed but not emitted

These events are subscribed to but have no emitter in the current state machines:

- `data_exchange.call.completed` — subscribed by [Eligibility/Decision](eligibility.md#decision), [Intake/Application](intake.md#application)
- `document_management.version.uploaded` — subscribed by [Intake/Application](intake.md#application)
- `eligibility.application.all_determined` — subscribed by [Intake/Application](intake.md#application)
- `eligibility.application.decision_completed` — subscribed by [Eligibility/Determination](eligibility.md#determination)
- `eligibility.application.determination_completed` — subscribed by [Intake/Application](intake.md#application)
- `eligibility.application.expedited` — subscribed by [Intake/Application](intake.md#application)
- `eligibility.decision.created` — subscribed by [Eligibility/Decision](eligibility.md#decision)
- `eligibility.determination.created` — subscribed by [Eligibility/Determination](eligibility.md#determination)
- `intake.verification.created` — subscribed by [Intake/Verification](intake.md#verification)
- `scheduling.appointment.scheduled` — subscribed by [Intake/Application](intake.md#application)
- `workflow.client_timeout` — subscribed by [Workflow/Task](workflow.md)
- `workflow.creation_deadline` — subscribed by [Workflow/Task](workflow.md)
- `workflow.sla_breach` — subscribed by [Workflow/Task](workflow.md)
- `workflow.sla_warning` — subscribed by [Workflow/Task](workflow.md)
- `workflow.task.created` — subscribed by [Workflow/Task](workflow.md)
- `workflow.task.updated` — subscribed by [Workflow/Task](workflow.md)
- `workflow.verification_timeout` — subscribed by [Workflow/Task](workflow.md)

# Decision Support State Machine

Domain: `decision-support` | API: [decision-support-suggestions-openapi.yaml](../../../contracts/base/domains/decision-support/decision-support-suggestions-openapi.yaml) | State machine: [decision-support-suggestions-state-machine.yaml](../../../contracts/decision-support-suggestions-state-machine.yaml)

---

## Suggestion

### Actions

- **accept** — Say yes. For an operation suggestion, make its call — or the corrected one sent — as the person accepting.
  - Transition: `proposed`/`refused` → `accepted`
  - If `object.kind is "operation" and has(request.call)`:
    - "$request.call"
    - sets `performed`
  - If `object.kind is "operation" and !has(request.call)`:
    - "$object.call"
  - Emit: `decision-support.suggestion.accepted`
- **dismiss** — Say no, with a reason.
  - Transition: `proposed`/`refused` → `dismissed`
  - sets `reason`
  - Emit: `decision-support.suggestion.dismissed`
- **expire** — Close a suggestion that no longer applies, before anyone decided.
  - Transition: `proposed`/`refused` → `expired`
  - Emit: `decision-support.suggestion.expired`

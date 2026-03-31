# Metrics

Operational metrics are defined as behavioral contract artifacts (`*-metrics.yaml`) and served by a cross-cutting API (`GET /metrics`, `GET /metrics/{metricId}`). They describe what to measure, how to aggregate it, and what targets indicate healthy performance.

See [Workflow Domain](../domains/workflow.md) for the domain-specific baseline metrics and [Mock Server](../../guides/mock-server.md) for how to query metrics in development.

---

**We support:** `*-metrics.yaml` per domain; `count`, `ratio`, and `duration` aggregate types; JSON Logic `filter` conditions on source data; `pairBy` for correlating event pairs in duration metrics; `targets` for declaring performance expectations; `groupBy` query parameter for dimensional breakdown; time-window and field filters on `GET /metrics`

| Concept | JSM | ServiceNow | IBM Curam | Salesforce Gov Cloud |
|---|---|---|---|---|
| Metric definitions | Custom gadgets + SLA reports | Performance Analytics indicators | MIS caseload reports | Reports + formula fields |
| Stored vs. computed | Pre-aggregated dashboards | Pre-aggregated by PA data collector | Pre-computed batch reports | Pre-aggregated by reports engine |
| Filter conditions | JQL (Jira Query Language) | Conditions (scripted or condition builder) | Fixed filter criteria on report type | SOQL filter criteria |
| Event-pair duration | Pre-computed `resolutionDate - createdDate` field | Pre-computed duration field on task record | Pre-computed case duration field | Pre-computed formula field |
| Performance targets | SLA goals on SLA agreements | PA thresholds with color-coding | Fixed targets in MIS | Report filter thresholds |
| Dimensional breakdown | Filter by project/team | Breakdown by group or category | Fixed groupings in report | Report group-by |

**In safety net benefits processing:**

Federal and state programs use operational metrics to monitor regulatory compliance (SLA breach rates, processing time distribution) and manage staff workload (queue depth trends, release rates). States typically maintain separate dashboards for each program — SNAP, Medicaid, TANF — and report aggregate metrics to federal partners annually. The metrics contract makes these measurement definitions explicit, portable, and auditable rather than buried in dashboard configuration.

---

## Design decisions

**Metrics as portable YAML artifacts, not dashboard configuration.** All major systems (JSM, ServiceNow, Salesforce) define metrics through a GUI that stores definitions in a proprietary database. This makes them non-portable, hard to version-control, and invisible to API consumers. We define metrics as contract artifacts alongside the state machine and rules — checked into version control, inspectable by tooling, and deployable alongside the API. This is a deliberate departure from industry norms, motivated by the blueprint's goal of making behavioral contracts explicit and portable across state implementations.

**Decomposed source + aggregate model.** Rather than naming specific metrics with hardcoded computation logic, we decompose each metric into a reusable structure: a `collection` to query, a JSON Logic `filter`, and an `aggregate` type (`count`, `ratio`, or `duration`). This means adding a new metric is always a data-definition problem, not a code problem. IBM Curam's MIS approach ties each metric to a fixed report type — adding a new metric often requires custom development. Our model allows states to define metrics declaratively without writing any server-side code.

**JSON Logic for filter conditions, not a query language.** JSM uses JQL; ServiceNow uses condition scripts or a GUI condition builder; Salesforce uses SOQL. Each is purpose-built for its platform. We use JSON Logic — the same evaluator already used for state machine guards and assignment rules — so there is no second filter language to learn, and metric filters can be validated and rendered by the same tooling. The trade-off is expressiveness: JSON Logic is less powerful than SQL. For the metric patterns needed in benefits processing (filter by field value, check array membership), it is sufficient.

**Declarative `from`/`to` event pairing for duration metrics.** Most systems pre-compute duration as a field on the task record (e.g., `resolutionDate - createdDate`). This approach requires deciding in advance which pairs of events define "duration" and baking that into the data model. Our declarative `from`/`to` + `pairBy` model lets metric authors define new duration measurements without schema changes — any pair of events correlated by a shared field can define a duration. This matches how time-series platforms like Grafana define duration queries, and it preserves flexibility as states add new transition types.

**`targets` declared in the metric definition.** Performance targets (e.g., median time to claim < 4 hours) are declared alongside the metric, not in a separate configuration UI. JSM puts goals on SLA agreements; ServiceNow puts thresholds on PA indicators. By embedding targets in the contract, the definition of "healthy" is explicit, version-controlled, and visible to implementers — not hidden in a dashboard. States that have different targets can override via their own metrics file (issue #174).

**`groupBy` is a query parameter, not part of the metric definition.** The metric definition declares what to measure; the caller decides how to slice it. ServiceNow's PA breakdowns are baked into the indicator definition — to add a new breakdown dimension, you modify the indicator. Our `groupBy` query parameter allows any caller to break down any metric by any field without modifying the definition. This is consistent with how Grafana and Prometheus handle dimensions: the metric defines the measurement, the query controls the grouping.

**Cross-cutting API, not domain-scoped.** A state supervisor dashboard typically shows metrics across multiple domains simultaneously — workflow queue depth, SLA breach rates, and potentially caseload counts from case management. Scoping metrics to a per-domain API would force the dashboard to fan out across multiple endpoints. A cross-cutting `GET /metrics` with a `domain` filter parameter allows single-call retrieval of any combination. ServiceNow's Performance Analytics operates the same way — indicators are defined per table but queried through a unified analytics API.

**Computed on demand, not pre-aggregated.** ServiceNow and JSM pre-aggregate metrics on a schedule for performance. For the blueprint's use case (development mock, contract definition), on-demand computation from live data is simpler, always current, and avoids the complexity of a separate aggregation pipeline. States building production implementations will add pre-aggregation in their adapters — the metric definitions remain the same; only the computation strategy changes.

---

## Extensibility

States will be able to override or extend `*-metrics.yaml` via overlay once issue #174 lands:

- Add state-specific metrics (e.g., metrics scoped to a program not in the baseline)
- Override `targets` to reflect state-specific performance goals
- Remove baseline metrics that do not apply to the state's program mix

The metric schema is designed to be extended without breaking changes: new aggregate types, new filter operators, and new target stat types can be added as additive fields. Existing metric consumers that don't recognize new fields will ignore them.

---

## Metrics vs. per-task `slaInfo`

These are distinct and complementary:

| | `slaInfo` on tasks | Metrics |
|---|---|---|
| **Scope** | Per task — tracks this task's SLA status | Aggregate — monitors program-wide trends |
| **Updated** | On every state transition | Computed on demand |
| **Access** | `GET /tasks/{id}` embedded in the resource | `GET /metrics` |
| **Purpose** | "Is this task about to breach?" | "What fraction of tasks are breaching?" |

`slaInfo` is operational — it drives caseworker and supervisor action on individual tasks. Metrics are analytical — they inform program management, staffing decisions, and federal reporting.

# Corticon glossary

Corticon is a commercial business-rules engine. States and vendors author eligibility/benefit
logic in it as a Corticon *project* — a folder of files, exported in an XML-based format. This
glossary explains that vocabulary for readers who haven't used Corticon before.

## The four file types

A Corticon project is built from four kinds of file, identified by extension. Each maps
one-to-one to a concept below.

| Extension | Called | What it holds |
|---|---|---|
| `.ecore` | **Vocabulary** | The data model: what business objects exist (e.g. `Household`, `Applicant`), what fields they have, and how they relate to each other. |
| `.ers` | **Rulesheet** | One decision table: a set of conditions and the actions to take when they're met. |
| `.erf` | **Ruleflow** | The orchestration script: what order rulesheets run in, and any branching/looping logic. |
| `.ert` | **Ruletest** | A captured test case: sample input data, run through the rules, with Corticon's own recorded output. |

## Vocabulary (`.ecore`)

- **Entity** — a business object type, like `Applicant` or `Household`. Similar to a class or a
  database table.
- **Attribute** — a plain field on an entity, like `Applicant.income`.
- **Association** (`EReference` in the file) — a link from one entity to another, like
  `Household.applicant` (a household has many applicants). Can be a single reference or a
  collection (`isCollection`/`upperBound="-1"` in the file).
- **Bidirectional association / `eOpposite`** — when two entities reference each other (e.g.
  `Household.applicant` and `Applicant.household`), Corticon marks both sides with an
  `eOpposite` attribute pointing at the other, marking them as the same relationship viewed from
  each side.
- **Required association / `lowerBound`** — marks an association that must always be present
  (e.g. every `Applicant` must belong to exactly one `Household`), as opposed to optional.
- **Custom type / enum** — a named list of allowed values for a field (e.g. a `state_name` type
  listing all 50 US states). Corticon represents this two different ways in the same file,
  sometimes both at once: a `customDataTypeList` entry (Corticon Studio's own UI metadata — base
  type, an `enumeration` flag, and the list of allowed values), and/or a standard EMF `EEnum`
  classifier (with an `eLiterals` list of the same values).

## Rulesheet (`.ers`)

A rulesheet is a **decision table** — think of a spreadsheet where each row is one rule, and
columns are split into conditions (checks) and actions (what to set).

- **Rule** — one row of the table: a set of conditions, and the actions to run if they're all
  true. **The first rule in every rulesheet is always a blank "documenting" placeholder** — a
  template row that Corticon Studio inserts automatically and never removes. It holds no conditions
  or actions; real rules start at index 1. Code that iterates over rules must skip this row
  explicitly (see `isBlankTemplateRule` in `rulesheet.js`).
- **Override** — an explicit priority relationship between two rules in the same rulesheet. When
  the overriding rule's condition is met, its action takes effect and the overridden rule's action
  is suppressed, even if the overridden rule's condition would also be true. Corticon's default
  guarantee (Design-Time Inferencing, DTI) is that rules in the same rulesheet are mutually
  exclusive — if two rules can both fire on the same data, Corticon flags it as a conflict at
  authoring time. An Override is how a rule author intentionally resolves that conflict with a
  declared priority instead.
- **Condition** — a check, like `Household.totalIncome < 20000`.
- **Action** — something the rule sets, like `Applicant.isEligible = true`.
- **`parserOutput`** — Corticon's own already-parsed expression tree for a condition or action,
  stored alongside the plain-text version.
- **Term / termtype** — each piece of a parsed expression is a "term," tagged with what kind of
  thing it refers to:
  - `ENTITY` — a business object, like `Applicant`.
  - `ATTRIBUTE` — a plain field, like `income`.
  - `METHOD` — a function call, like `.round(2)`, `.yearsBetween(today)`, `.contains('x')`. The
    field it's called *on* is the method term's own parent in the tree, not the method term
    itself.
  - `COLLECTION` — an operation across multiple related records, like `->sum`, `->size`,
    `->sortedBy(...)->first`. Corticon has no implicit ordering for a collection; picking "the
    first" or "the best" always requires an explicit sort.
  - `NEW` — creating a brand-new entity instance (`Household.newUnique[...]`).
- **`logicalVariable` / alias** — a rulesheet gives each entity it works with a short nickname
  (e.g. calling `Household` just `"H"`), and can also give a nickname to a related entity it
  navigates to via an association (an `extension`).
- **Filter** — a named, reusable, narrowed-down view of a collection — e.g. "only the adult
  members of this household" out of all household members. Defined once, then reused by any rule
  that needs that subset.

## Ruleflow (`.erf`)

The ruleflow is the "script" — it says which rulesheets run, in what order, and under what
conditions.

- **`ActivityNode`** — one step in the flow: run this one rulesheet (or invoke a nested ruleflow,
  or call out to an external system), then move to the next step.
- **`BranchContainer`** — a fork in the flow: check a condition, then take a different path
  depending on the result. Typically just *one* path for the matching case, falling through to
  whatever comes next otherwise (not a two-way if/else) — or, for a multi-valued field, a true
  multi-way switch (one path per possible value).
- **`iterative`** — a plain yes/no flag on a step, meaning "keep re-running this until nothing
  changes anymore." This is how Corticon expresses a loop — there's no separate "loop" node type,
  just this flag on an ordinary step.
- **Service Call-Out / `connectorList`** — a call out to an external system (a database lookup, a
  web service, etc.) in the middle of rule evaluation. In Corticon Studio this is called a "Service
  Call-Out." In the `.erf` file it appears as a `connectorList` entry on the ruleflow, with two
  fields: `className` (the JavaScript file that implements the call, e.g.
  `FetchServiceCallout.js`) and `serviceName` (the method to invoke on that class, e.g.
  `fetchURL`). An `ActivityNode` that performs a service call-out references the connector by
  index (`invokes="#//@ruleflow/@connectorList.0"`) rather than by a rulesheet filename. The
  service runs mid-evaluation and its outputs are merged back into the working data before any
  subsequent rules run — from the rules' perspective, the service result looks like any other
  input Fact.

## Ruletest (`.ert`)

A captured test case: sample input data plus Corticon's own recorded step-by-step output when
that data was actually run through the rules.

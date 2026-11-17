# Known traps

Bugs in the blueprint packages at the versions in [versions.json](versions.json), and docs that don't match them. Most fail silently or with a misleading error, so check this list before writing each kind of file, and again when something fails for no reason you can see. When you work around one, add a comment in the file naming the trap, and list it in the README's Workarounds section, so it can be undone once the blueprint is fixed.

Each trap was checked against those versions. When the skill moves to newer packages, check each one again and remove the ones that are fixed.

## Records and APIs

| Trap | What happens | Work around it |
|---|---|---|
| A path that starts with the domain's name, like `/orders` in domain `orders`, or `/menu-items` in domain `menu` | The mock serves the list and item routes without the domain prefix, and creating a record answers 501 | Don't start a path with the domain id. Rename the domain (`ordering`) or the path (`/menu/items`) |
| A record whose plural isn't its name plus "s", like `Delivery` | Created records get no starting stage, and every action answers 409 "it is undefined" | Have whatever creates it set the starting stage, or pick a name whose plural adds "s" |
| Two domains with the same path, like `/settings` | They share one store, and each reads and changes the other's records | Give each domain's path its own name (`/order-settings`, `/dispatch-settings`) |
| An update schema closed to extra fields | Every PATCH answers 422 "id is not allowed" | Leave update schemas open |
| A record with a field named `items` | A single-record GET is taken for a list, and validation asks for search, limit and offset parameters. Sample records with an `items` list are never loaded, with no warning | Name the field for what it holds (`lineItems`, `requestedItems`) |
| Sample data whose key contains "create", "update" or "payload" | That sample record is never loaded, with no warning | Name sample records without those words |

## Lifecycles and reactions

| Trap | What happens | Work around it |
|---|---|---|
| A lookup (`context:`) with no `where` | The mock skips it and binds nothing, though the schema allows it | Always give a `where`, even to fetch the only settings record |
| A step that calls another action by path | It runs with the original caller's roles. If refused, nothing is logged and the first action still succeeds | Call the action by `operationId` |
| The docs' `requestTimer` and `cancelTimer` procedures | They ship only with the safety-net contracts | Emit `platform.timer.requested` and `platform.timer.cancelled` directly, as core's suggestion state machine does (`base-contracts/domains/decision-support/`) |
| `on: - name: …` in some doc examples | Validation refuses it | Write `on: - type: …` |
| `invoke:` steps and a `rules:` section in `rpc.yaml` | Removed from the language | Use `call:` and a separate rules file, as behavioral-contract-dsl.md shows |
| A stage change that isn't declared in `emits:` | Nothing is announced, so measures and reactions that need it never see it | Declare every announcement a measure or another domain needs |

## Measures

| Trap | What happens | Work around it |
|---|---|---|
| Measures in any domain | The mock serves them only at `/workflow/metrics` | Write them anyway. Say in the README that the mock can't show them, and check their events instead |
| Measure filters | The docs say CEL; the schema and mock use JSON Logic | Write JSON Logic |

## Tools

| Trap | What happens | Work around it |
|---|---|---|
| `blueprint-scaffold-api` | Takes `--name menu` (not `--name=menu`), and its output has the wrong schema name, path, refs and server URL | Don't use it |
| `blueprint-build-explorer` | Fails with ENOENT unless two settings files exist | Write them as [setup.md](setup.md) shows |
| Sample data timestamps | The mock replaces `createdAt` and `updatedAt` with dates in 2024 | Don't rely on them in a scenario |
| Calculations | A value in a lifecycle is only ever looked up, never computed | Work out amounts in a ruleset. An empty list's `sum()` is the integer 0, and adding it to a decimal fails, so write `([0.0] + list).sum()` |

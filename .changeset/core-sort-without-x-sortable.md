---
"@codeforamerica/blueprint-core": patch
---

Before, an operation could declare a `sort` query parameter while the server rejected every `?sort=` it advertised, because sorting is gated on a separate `x-sortable` extension and nothing checked the two agreed. Now `validate` warns when a sort parameter is declared without one. (#448)

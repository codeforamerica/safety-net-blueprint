---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** Event stubs take `response` where they took `respond`, and both kinds of stub now answer `422` naming any key they do not recognize — before, a misspelled key registered, listed and then did nothing. `schemas/stubs-schema.json` describes both. (#283)

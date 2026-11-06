---
"@codeforamerica/blueprint-safety-net-contracts": patch
---

Before, the `applicationReview` composition's contact section asked for `email`, `preferredLanguage` and `preferredContactMethod`, which members don't have, so it returned no email. Now it returns `contact.email`. (#516)

---
"@codeforamerica/blueprint-explorer": minor
---

Before, a site's Try it ran in one environment. Now `environments` in `config.yaml` lists each one's config, overlays, routing and sign-in, and the Try it panel switches between them, each keeping its own records, stubs and sign-in; `releaseEnvironment` writes the first one's contracts for the build. Where the environment's contracts say how to sign in (OAuth 2.0 or OpenID Connect), the panel has Sign in, and a call that requires it asks first, as Swagger UI's Authorize does; `sign_in` in `config.yaml` names the client. (#473)

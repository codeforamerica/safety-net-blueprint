---
"@codeforamerica/blueprint-explorer": minor
---

`environments` in `config.yaml` lists each one's config, overlays, routing and sign-in, and with Try it on, a menu in the page's header switches between them, each keeping its own records and sign-in; `releaseEnvironment` writes the first one's contracts for the build. Where the environment's contracts say how to sign in (OAuth 2.0 or OpenID Connect), the header has Sign in, and a call that requires it asks first, as Swagger UI's Authorize does; `sign_in` in `config.yaml` names the client. A call sent to a real server carries only the headers its API's contract declares, with its security schemes'. (#473)

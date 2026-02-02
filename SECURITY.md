# Security

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it by emailing [security@codeforamerica.org](mailto:security@codeforamerica.org) rather than opening a public issue.

## Known Vulnerabilities

### Newman (Test Dependency)

**Status:** Accepted risk
**Date:** 2026-02-02

The `newman` package (Postman CLI for API testing) has several known vulnerabilities in its dependencies:

| Package | Severity | Advisory |
|---------|----------|----------|
| jose | moderate | [GHSA-hhhv-q57g-882q](https://github.com/advisories/GHSA-hhhv-q57g-882q) |
| lodash | moderate | [GHSA-xxjr-mmjv-4gpg](https://github.com/advisories/GHSA-xxjr-mmjv-4gpg) |
| node-forge | high | [GHSA-554w-wpv2-vw27](https://github.com/advisories/GHSA-554w-wpv2-vw27) |
| qs | high | [GHSA-6rw7-vpxm-498p](https://github.com/advisories/GHSA-6rw7-vpxm-498p) |

**Why we accept this risk:**

1. These are **dev dependencies only** - they are not included in any production builds or runtime code
2. Newman is used solely for integration testing during development
3. The vulnerabilities require specifically crafted malicious input to exploit
4. The upstream maintainers (Postman) have not yet released patches
5. Forcing dependency overrides may break newman's functionality

**Mitigation:**

- Newman is not used in production environments
- Test inputs are controlled and not from untrusted sources
- We will update when patches become available upstream

**To check current status:**

```bash
npm audit
```

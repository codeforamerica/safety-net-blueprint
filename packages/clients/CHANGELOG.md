# Changelog

All notable changes to `@codeforamerica/safety-net-blueprint-clients` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-03-03

### Added

- Search helpers with semantic file organization
- Utilities path for packaging

### Fixed

- Windows glob expansion in test scripts (replaced shell globs with directory paths)
- Postman generator sort order and path param extraction fixes

## [1.0.0] - 2026-01-15

### Added

- TypeScript client generation via `@hey-api/openapi-ts` with Zod 4.x schemas
- JSON Schema conversion from OpenAPI specs
- Postman collection generation
- State-specific package builder (`build-state-package.js`) producing `@codeforamerica/safety-net-openapi-{state}` packages
- npm workspace packaging and publishing infrastructure

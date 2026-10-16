# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-16

First public release.

### Added

- `POST /v1/tickets`: classifies a ticket (category, priority, sentiment, summary, suggested reply) with an LLM and stores it.
- `GET /v1/tickets` (pagination, category/priority filters) and `GET /v1/tickets/:id`, scoped per client.
- `GET /v1/usage`: tokens, attempts and estimated cost per UTC day, plus daily budget status.
- Liveness and readiness endpoints (`/health/live`, `/health/ready`).
- API key authentication with SHA-256 hashed keys and a `pnpm client:create` CLI.
- Per-key rate limiting and per-client daily token budgets.
- `LlmProvider` interface with an Anthropic adapter (official SDK, structured outputs, timeout, transport retries, refusal fallback) and a deterministic fake provider.
- Strict Zod validation of model output with one retry, and 502/503/504 error mapping.
- Prompt-injection hygiene: separated instructions, delimited and escaped ticket data, no tools, constrained output, no customer email sent to the LLM.
- Per-attempt usage and cost tracking with a single pricing table.
- RFC 9457 problem details, request ids, helmet, structured logging with redaction.
- OpenAPI 3.1 generated from the Zod schemas, Swagger UI at `/docs` and `docs/openapi.json`.
- Drizzle ORM schema with versioned migrations; docker-compose PostgreSQL 18.
- Vitest suite (unit + integration on PostgreSQL, SDK tests against a local stub server), ESLint, Prettier, typecheck.
- CI (lint, format, typecheck, build, audit, tests, gitleaks), Dependabot, pre-commit gitleaks hook and SECURITY.md.

[Unreleased]: https://github.com/Velosog/ticket-triage-api/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Velosog/ticket-triage-api/releases/tag/v0.1.0

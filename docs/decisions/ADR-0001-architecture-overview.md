# ADR-0001: Preserve the Current Service Boundaries

- **Status:** Accepted as a documentation baseline; revisit through a reviewed architecture change.
- **Date:** 2026-10-18
- **Decision owners:** LIFE-LINK maintainers

## Context
The repository is a monorepo with a Next.js frontend, Express API, Supabase auth/database integration, SQL migrations, and a separate Python/FastAPI ML subsystem. Multiple coding agents may work on separate features, so implicit architectural assumptions can cause drift.

## Decision
1. Treat `frontend/src/app/**` as the current Next.js app-router UI unless deployment configuration proves otherwise.
2. Treat Express routes and services under `backend/src/**` as the authoritative HTTP business API.
3. Treat Supabase migrations/RLS/transactional SQL as part of the application architecture, not as optional setup notes.
4. Treat `ml/**` as a separate inference/training subsystem with an explicit feature contract.
5. Keep project documentation in `docs/**` and require agents to consult it and source code before implementing cross-cutting changes.
6. Do not add new infrastructure (vector database, new orchestration service, etc.) merely to solve documentation or agent context problems.

## Consequences
- Agents should avoid mixing legacy Vite files with current Next.js behavior.
- API contracts, database state transitions, auth roles, and ML feature order must be verified against source and tests.
- Changes to a service boundary require a new ADR or an update to this ADR.
- Documentation must call out unresolved inconsistencies rather than silently choosing one interpretation.

## Alternatives considered
- One large README: rejected because it cannot provide enough detail for architecture, design, tests and task tracking.
- Duplicate per-agent instructions: rejected in favor of a shared protocol plus lightweight tool-specific entry points.
- Treating Graphify as a runtime oracle: rejected; a code graph is a navigation aid and source code/tests remain authoritative.

# LIFE-LINK Project Knowledge Base

This directory is the shared, repository-scoped source of truth for product intent, architecture, design conventions, verification, decisions, status, and cross-agent coordination.

## Start here
1. [Product requirements](product/PRD.md)
2. [Architecture](architecture/ARCHITECTURE.md)
3. [Design system and UX](design/DESIGN.md)
4. [Test strategy](testing/TEST_PLAN.md)
5. [Project status](project-status.md)
6. [Next tasks](next-tasks.md)
7. [Agent work protocol](agent-work-protocol.md)
8. [Architecture overview decision](decisions/ADR-0001-architecture-overview.md)

## Evidence rules
- These docs were drafted against the public `master` tree and source files available at the time of writing. Re-check source before changing behavior.
- Source code and migrations are authoritative for current implementation. This documentation describes observed behavior and clearly labels unknowns/proposals.
- ML metric claims are transcribed from the ML documentation in the repository; they have not been independently reproduced in this documentation task.
- Do not treat mock/demo flows, UI labels, or comments as proof that a production workflow is operational.
- Keep secrets out of docs. Use `.env.example` only as a list of variable names, never copy live values.
- Update these documents when a change alters behavior, architecture, data contracts, tests, or delivery status.

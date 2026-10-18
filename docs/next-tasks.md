# Next Tasks — LIFE-LINK

Priorities are proposed from source review and should be confirmed by maintainers.

## P0 — Resolve correctness and release uncertainty
- [ ] **Canonicalize production ML model identity.** Inspect `ml/api/main.py`, `ml/scripts/load_production_model.py`, `ml/models/model_metadata.json` and deployment config; align both ML READMEs with the artifact actually loaded.
- [ ] **Document account provisioning.** Trace how approved users/institutions are inserted into `public.users` and `organization_members`; record the supported onboarding path and failure/recovery behavior.
- [ ] **Run release verification.** Execute backend tests, frontend build and ML tests in clean environments; record exact commands, results and commit SHA.
- [ ] **Verify migration state.** Compare all committed SQL migrations with the target Supabase database and document safe rollout/rollback practices.
- [ ] **Confirm production routing.** Verify Vercel API rewrite and Railway service URL agree; remove redundant/conflicting config only after confirming platform behavior.

## P1 — Improve cross-agent reliability
- [ ] Add a root README with prerequisites, service startup, environment setup, tests and links into `docs/`.
- [ ] Add a route/API inventory with method, path, role, ownership check, request/response schema and test file.
- [ ] Add a concise ERD from migrations, including key relationships, RLS assumptions and state enums.
- [ ] Add frontend end-to-end tests for OTP, unprovisioned/inactive accounts, and role navigation.
- [ ] Add CI checks for backend tests, frontend build, ML tests and documentation links.
- [ ] Add API contract tests for frontend typed client versus Express response/error shapes.

## P2 — Product and operations
- [ ] Define explicit SLA/escalation behavior for critical requests and donor no-response cases.
- [ ] Define privacy/retention rules for donor location, profile and audit data.
- [ ] Define ML monitoring, threshold policy, drift response and a safe fallback when the inference service is unavailable.
- [ ] Add operational runbooks for degraded Supabase, ML API, routing service and email/OTP delivery.

## Task completion rule
A task is complete only when the code/config change is implemented, relevant tests are run, the source-of-truth docs are updated, and the result is reported with evidence.

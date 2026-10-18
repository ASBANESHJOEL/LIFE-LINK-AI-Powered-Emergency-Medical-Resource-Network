# Project Status — LIFE-LINK

**Snapshot date:** 2026-10-18  
**Source baseline:** public GitHub `master` branch as retrieved for this documentation pass.  
**Important:** this is a source-tree snapshot, not a live deployment health report.

## Implemented in repository (source evidence)
- Next.js app-router frontend with public pages and role-oriented workspace pages.
- Supabase email OTP sign-in/verification and a client auth provider.
- Express API with bearer-token validation and DB-backed user/organization resolution.
- Hospital emergency request creation and cancellation route.
- Separate inventory resolution and peer-bank sourcing endpoints.
- Donor eligibility, ranking, dispatch, tracking and notification route/service modules.
- SQL migrations for inventory allocation, donor dispatch, notifications, tenant isolation, emergency resilience and orchestration.
- ML training/evaluation scripts, saved artifacts, FastAPI inference app and tests.
- Backend test suites for auth, RLS, inventory transactions, donor workflows, critical paths and observability.
- Vercel/Railway deployment configuration.

## Not verified by this pass
- Whether production deployments are healthy or match this branch.
- Whether Supabase migrations have all been applied to the target project.
- Whether all environment variables are correctly configured in production.
- Whether every workflow is fully connected end-to-end.
- Whether automated tests/builds currently pass.
- Whether current production ML uses Logistic Regression V1 or an XGBoost artifact.

## Known documentation/maintenance gaps
1. Root `README.md` is empty.
2. ML documentation conflicts on which artifact/model is production: `ml/README.md` selects XGBoost baseline, while `ml/models/README.md` identifies Logistic Regression V1.
3. Legacy Vite/React Router files coexist with Next.js app-router files.
4. API rewrites appear in both `frontend/next.config.mjs` and `frontend/vercel.json`; confirm deployed behavior.
5. New-user authentication does not itself prove a LIFE-LINK registry profile is provisioned; onboarding/provisioning must be documented from its authoritative workflow.
6. Existing test suites are extensive, but no tests were executed during this docs pass.

## Progress reporting convention
Use `Implemented`, `In progress`, `Blocked`, `Proposed`, or `Needs verification`. Never label a feature complete solely because a route/page/file exists.

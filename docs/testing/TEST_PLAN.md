# Test Plan — LIFE-LINK

## 1. Existing automated test coverage
The repository contains Node's built-in test-runner suites under `backend/test/`, including:
- API smoke and auth route matrix
- authenticated integration and development auth
- signup check and signup/availability regression
- donor eligibility, ranking, dispatch, dispatch response and tracking
- emergency critical path and resource orchestration
- inventory transactional behavior
- notifications
- OSRM service
- input validation
- production reliability/observability
- tenant isolation/RLS

The ML subsystem includes pytest suites in `ml/tests/test_api.py` and `ml/tests/test_production_model.py`.

## 2. Commands from package configuration
From repository root:
```bash
npm run test:backend
npm run build:frontend
```
From `backend/`:
```bash
npm test
npm run test:rls
npm run test:critical-path
npm run test:resource-orchestration
npm run test:production-reliability
```
For ML, install `ml/requirements.txt` in an isolated Python environment and run `pytest ml/tests` (confirm pytest is installed in the selected environment).

These are documented commands, not a claim that tests were executed or currently pass.

## 3. Critical acceptance scenarios
### Authentication and provisioning
- Missing, malformed, expired and invalid bearer tokens are rejected.
- Authenticated identity without a matching `public.users` row is denied as unprovisioned.
- Inactive users are denied.
- Roles are sourced from trusted DB profile, never request body/header.
- Hospital/blood-bank endpoints require active organization membership and correct ownership.
- Development mock tokens cannot authenticate in production.

### Emergency requests
- Only hospital-role users can create requests.
- Request creation rejects invalid blood group, component type, urgency, quantity and malformed coordinate pairs/ranges.
- A request cannot be resolved by a different hospital.
- Inventory resolution rejects invalid request states.
- Inventory reservation is concurrency-safe and does not oversell.
- Audit/log failures do not silently change the request's core business result without an explicit product decision.

### Peer transfers and donor dispatch
- Peer-bank offers are created only for authorized hospital-owned requests in eligible states.
- Offer acceptance/rejection handles duplicate and conflicting transitions safely.
- Donor eligibility excludes incompatible, unavailable or ineligible donors.
- Dispatch response, withdrawal, tracking, GPS timeout and completion enforce ownership and legal state transitions.
- Parallel donor responses do not allocate the same emergency need twice.
- Critical-path recovery handles no response, cancellation, stale location, unavailable inventory and partial fulfillment.

### Notifications, routing and observability
- Users can only list/update their own notifications.
- Pagination and unread filtering behave correctly.
- OSRM failures/timeouts are handled with explicit fallback behavior.
- Request correlation IDs are preserved; errors are sanitized.
- Health checks report service readiness appropriately.

### ML
- Invalid or missing features return validation errors.
- Feature order and schema match model metadata.
- Inference loads the intended production artifact, not an experimental artifact.
- Predictions are treated as advisory ranking signals; no critical medical decision is made solely by the model.
- Test data split and reported metrics are reproducible; verify donor-level separation and leakage exclusions.

## 4. Verification gaps
- No test command was executed as part of authoring these docs.
- Frontend package has build script but no dedicated frontend test script in its package manifest.
- Add end-to-end coverage for login/signup/OTP and role-based page access.
- Add integration coverage for production-like Supabase schema/migrations and deploy rewrites.
- Verify accessibility and mobile layouts manually or through browser automation.

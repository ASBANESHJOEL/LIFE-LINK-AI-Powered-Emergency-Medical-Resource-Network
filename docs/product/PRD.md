# Product Requirements Document — LIFE-LINK

## 1. Product summary
LIFE-LINK is an emergency medical resource coordination network focused on blood and blood-component requests. It connects hospitals, blood banks, and volunteer donors through a role-aware web application, API services, inventory and peer-transfer workflows, donor dispatch/tracking, notifications, and an ML donor-response prediction service.

## 2. Problem and intended outcome
Emergency blood sourcing is fragmented across hospitals, blood banks, and individual donors. LIFE-LINK aims to make requests, resource discovery, donor responses, and status visibility more coordinated and auditable. The product supports coordination; it is not a replacement for clinical judgment or official medical procedures.

## 3. User roles evidenced in the code
- **Hospital:** view dashboard; create and track emergency requests; request inventory resolution and peer-bank sourcing; view dispatch/tracking.
- **Blood bank:** manage/view inventory and requests; participate in peer-transfer workflows.
- **Donor:** view dashboard and alerts; respond to dispatches; access tracking and notifications.
- **Admin / Regulator:** operational/audit dashboard routes exist. Exact permission scope should be verified route by route before extending.
- **Public visitor:** landing, about, FAQ, contact, terms, privacy, role selection, login/signup and OTP verification.

## 4. Functional requirements (observed)
1. Passwordless email OTP authentication through Supabase Auth.
2. Resolve the authenticated Supabase identity to a trusted LIFE-LINK `public.users` profile.
3. Deny privileged access when the profile is missing or inactive.
4. Resolve active organization membership for hospital and blood-bank roles.
5. Create hospital emergency requests with validated blood group, component type, quantity, urgency, and optional coordinates.
6. Permit a hospital to request inventory-first resolution for its own open/partially fulfilled request.
7. Support peer-bank transfer offer creation for eligible requests.
8. Support donor eligibility/ranking, dispatch lifecycle and donor tracking APIs.
9. Provide donor in-app notifications and mark-as-read behavior with server-side ownership checks.
10. Expose health endpoints and request correlation/error-handling infrastructure.
11. Provide an ML inference API for donor response prediction; exact runtime integration and production routing must be verified before asserting live use.

## 5. Quality and safety requirements
- Enforce authentication and server-derived roles/organization ownership for protected operations.
- Treat all client-supplied identifiers and roles as untrusted.
- Validate input and reject invalid state transitions; use transactional database functions where concurrent inventory/dispatch actions require atomicity.
- Keep tenant data isolated with database policies and tests.
- Do not present ML predictions as clinical decisions or guarantees.
- Preserve auditability and correlation IDs for critical emergency workflows.
- Avoid leaking credentials, private medical data, tokens, or internal stack traces to clients.
- Maintain responsive layouts and accessible labels/focus behavior for critical actions.

## 6. Non-functional expectations
- Reliability during time-sensitive request and donor-dispatch workflows.
- Clear status, failure and recovery feedback.
- Predictable API contracts and consistent error shapes.
- Observable service health and actionable logs.
- Maintainable boundaries between Next.js UI, Express API, Supabase persistence/auth, and ML inference.

## 7. Out of scope / not assumed
- No claim that the system is clinically certified or ready for real-world medical operations.
- No claim that every role or workflow is fully provisioned in production.
- No assumption of real-time push delivery unless verified in implementation; polling is present for the unread notification count.
- No claim that inventory/peer transfer/donor orchestration runs automatically on request creation; source comments indicate some resolution steps are explicitly invoked.
- Do not add unrelated features without a product decision.

## 8. Open product questions
- What is the authoritative onboarding/provisioning workflow for new users and institutional accounts?
- Which actions are restricted to verified institutions and which are regulator/admin-only?
- Should request creation automatically start inventory/peer-bank/donor resolution, or remain an explicit step?
- What are the service-level targets and escalation rules for critical requests?
- What privacy, retention, consent and audit requirements govern donor location and medical eligibility data?
- What is the canonical production ML artifact and deployment version?

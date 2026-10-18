# Architecture — LIFE-LINK

## 1. Repository shape
- `frontend/`: Next.js 14 / React 18 / TypeScript, Tailwind CSS, shared UI components, Supabase browser auth, typed API client, role-oriented pages.
- `backend/`: Node.js (>=22) / Express 4 / Supabase JS; auth middleware, REST routes, domain services, SQL migrations and Node test suite.
- `ml/`: Python/FastAPI inference service, feature engineering/training/evaluation scripts, model artifacts and tests.
- Root `package.json`: convenience scripts for frontend, backend, and backend tests.

## 2. Runtime/deployment shape (configured)
- Frontend is configured for Vercel and rewrites `/api/:path*` to the backend.
- Backend has Railway configuration, with `/api/health` as healthcheck.
- Backend uses Supabase server-side credentials and validates required environment variables at startup.
- ML includes Railway configuration and a FastAPI app. Deployment state and the exact production model loaded must be verified from deployment settings/logs, not inferred from config alone.

## 3. Request path
1. Browser renders Next.js routes and uses `AuthProvider` to inspect the Supabase session.
2. The typed API client sends API requests and attaches the current bearer token (development auth has a separate local token path).
3. Vercel/Next rewrite forwards `/api` requests to Express.
4. Express applies security headers, request correlation, CORS, JSON body limits, health/auth/business routes, not-found handling and centralized error handling.
5. Protected routes use `requireAuth`; it validates the Supabase access token, resolves the application user from `public.users`, rejects missing/inactive profiles, and resolves active organization membership for hospital/blood-bank users.
6. Domain routes/services call Supabase using the server-side admin client. Database migrations define transactional/RLS protections for critical resource operations.

## 4. Main backend domains
- Authentication and signup status: `backend/src/routes/authRoutes.js`, `backend/src/middleware/auth.js`.
- Emergency requests: `backend/src/routes/requests.js`.
- Inventory allocation: `backend/src/routes/inventoryRoutes.js`, `backend/src/services/inventoryService.js`, SQL RPC/migrations.
- Peer-bank transfers: `backend/src/routes/peerTransferRoutes.js`, `peerTransferAcceptanceRoutes.js`, `peerTransferService.js`.
- Donor eligibility/ranking/dispatch/tracking: `donorEligibilityRoutes.js`, `donorRankingRoutes.js`, `donorDispatchRoutes.js`, `donorDispatchService.js`.
- Notifications: `notificationRoutes.js`, `notificationService.js`.
- Routing: `osrmService.js`.
- ML: `ml/api/main.py`, scripts and saved artifacts.

## 5. Trust and authorization boundaries
- Browser-side route gating is a UX layer, not a security boundary.
- Backend must derive identity and roles from validated tokens and trusted database rows.
- Organization ownership must be checked server-side for every hospital-owned request and blood-bank-owned resource.
- SQL RLS and transactional functions are important defense-in-depth; review migrations and tests together for data-access changes.
- Development mock auth must remain disabled in production. Startup validation rejects `LIFELINK_DEV_AUTH_ENABLED=true` when `NODE_ENV=production`.

## 6. Data model concepts observed in source/migrations
The application references `users`, `organization_members`, `hospitals`, `blood_banks`, `emergency_requests`, inventory records/allocations, peer-transfer offers/acceptance, donor dispatches, donor notifications, audit logs and donor history/features. This list is conceptual, not a complete ERD; migrations and live schema are the authority.

## 7. ML subsystem
The ML service predicts positive donor dispatch response from 18 dispatch-time features according to its docs. Repository documentation contains different model descriptions: `ml/README.md` discusses XGBoost baseline/HEM and `ml/models/README.md` identifies Logistic Regression as production V1. Treat this as a documentation inconsistency to resolve by inspecting `ml/api/main.py`, model loader and metadata before deployment changes.

## 8. Architectural risks / verification items
- Root README is empty; onboarding currently lacks a single canonical overview.
- Frontend contains both active Next.js app-router files and legacy Vite/React Router files. Prefer `frontend/src/app/**` for the current app unless deployment config proves otherwise.
- Next.js config and `frontend/vercel.json` both define API rewrites; verify which configuration is authoritative in the deployed environment.
- The frontend API client and auth context should be checked together when changing token/session behavior.
- Request creation comments say inventory reservation is not performed inside that handler; resolution is a separate endpoint.
- ML production artifact/model identifier needs one canonical source of truth.
- Tests in the repository are not proof of passing status; execute them in CI/local environment before release.

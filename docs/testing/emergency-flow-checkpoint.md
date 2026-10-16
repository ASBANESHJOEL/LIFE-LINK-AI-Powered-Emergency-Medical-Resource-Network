# LIFE-LINK Emergency Flow API Checkpoint

**Branch:** automation  
**Purpose:** staging-only end-to-end checkpoint for hospital inventory-first resolution, donor dispatch/tracking, donor exhaustion, and peer-bank fallback.  
**Safety:** Never point this suite at production. It creates emergency requests, reserves inventory, creates dispatches, and can alter donor availability. Use a dedicated local/staging Supabase project and synthetic test accounts/data only.

## Required test environment variables

- `baseUrl`: isolated backend base URL (for example local API)
- `hospitalToken`: authenticated, verified HOSPITAL test account with a provisioned hospital organization
- `donorToken1` ... `donorTokenN`: distinct synthetic donor accounts, one token per donor
- `hospitalLatitude`, `hospitalLongitude`: test hospital coordinates
- `inventoryFixtureSufficientRequest`: optional pre-created synthetic request ID if testing a fixture rather than creating one
- `peerBankToken`: optional blood-bank account token for accepting a transfer offer
- Test data must provide at least one verified hospital, sufficient/insufficient matching inventory fixtures, and multiple eligible synthetic donors. No real donor data.

## Scenario A — inventory fully covers the request

1. Hospital: `POST /api/requests` with a small quantity and known matching blood group/component.
2. Hospital: `POST /api/requests/:requestId/resolve/inventory`.
3. Assert `allocatedUnits === requestedUnits`, `remainingUnits === 0`, and `fullyReserved === true`.
4. Read request state from the trusted test DB/authorized request endpoint and assert `FULFILLED`.
5. Assert no donor dispatch exists for this request.
6. Stop this scenario. Do not call donor matching.

**Current implementation note:** request creation returns resolution `PENDING`; inventory resolution is a separate endpoint. This checkpoint explicitly invokes the inventory endpoint rather than assuming request creation performs inventory reservation.

## Scenario B — inventory is insufficient; donor accepts and is tracked

1. Seed matching synthetic inventory below the requested quantity.
2. Hospital creates the request; resolve inventory.
3. Assert allocated units are less than requested units, and remaining need is positive; request should remain `PARTIALLY_FULFILLED` when some units were reserved, otherwise `OPEN`.
4. Hospital calls `GET /api/requests/:requestId/eligible-donors`; assert only eligible donors are returned.
5. Hospital calls `POST /api/requests/:requestId/donor-dispatches/next-batch`.
6. Each selected donor uses their own token to call `POST /api/donor-dispatches/:dispatchId/respond` with `{"response":"ACCEPT"}`.
7. Donor starts tracking with `POST /api/donor-dispatches/:dispatchId/tracking/start`; records synthetic GPS with `POST /api/donor-dispatches/:dispatchId/location`; arrives with `POST /api/donor-dispatches/:dispatchId/tracking/arrive`.
8. Hospital completes the dispatch with `POST /api/donor-dispatches/:dispatchId/tracking/complete`.
9. Assert dispatch lifecycle transitions are valid and request fulfilment is determined by actual inventory allocations, not acceptance alone. Confirm no over-dispatch relative to remaining units.

## Scenario C — all donors decline

1. Create a separate synthetic request with insufficient matching inventory and at least 2 eligible synthetic donors.
2. Resolve inventory, fetch eligible donors, and create the next dispatch batch.
3. For every dispatch, use that donor's own token and call `POST /api/donor-dispatches/:dispatchId/respond` with `{"response":"DECLINE"}`.
4. Re-run the hospital next-batch endpoint until the candidate pool is exhausted. Assert declined donors are not dispatched again for the same request and each batch advances correctly.
5. At exhaustion, record the returned `reason` (expected service-level outcomes include `NO_ELIGIBLE_DONORS` or `NO_AVAILABLE_NEXT_BATCH`).
6. Explicitly call `POST /api/requests/:requestId/resolve/peer-banks`; assert offers reflect only the remaining needed quantity. If no peer bank can supply it, verify the request remains OPEN/PARTIALLY_FULFILLED and surface an actionable hospital escalation/notification.

## Important observed gap — automatic fallback is not yet proven

The current route exposes peer-bank resolution separately at `POST /api/requests/:requestId/resolve/peer-banks`. The inspected donor-dispatch service returns `NO_ELIGIBLE_DONORS` or `NO_AVAILABLE_NEXT_BATCH` when it cannot make a batch. These code paths do **not** themselves demonstrate that donor exhaustion automatically invokes peer-bank resolution. Until an orchestration service and test prove it, Scenario C explicitly invokes peer-bank resolution and must report automatic fallback as **NOT VERIFIED**.

## Pass criteria

- Every mutation runs only against isolated synthetic test data.
- Inventory allocations conserve stock; no negative/oversold inventory.
- A fully inventory-covered request creates no donor dispatch.
- Partial inventory coverage preserves the remaining need.
- Donor acceptance alone does not mark a request fulfilled.
- Declined donors are not re-notified for the same request.
- Tracking follows legal dispatch transitions and uses synthetic coordinates.
- Exhaustion is visible and does not silently close an unfulfilled request.
- Peer-bank resolution is attempted or clearly escalated; no claim of automatic fallback until tested.
- Cleanup removes only test artifacts owned by the test run.

# UX and Design Notes — LIFE-LINK

## 1. Design intent
The current UI presents LIFE-LINK as a calm, trustworthy emergency resource network. The landing page emphasizes “Connect. Donate. Save Lives.” with hospitals, blood banks and donors as the core participants.

## 2. Visual language observed
- **Framework:** Tailwind CSS with shared component styles in `frontend/src/app/globals.css`, `frontend/src/index.css`, and `frontend/tailwind.config.js`.
- **Primary UI:** blue/slate surfaces and typography for navigation and workspace structure.
- **Urgency/status:** red is used for emergency/heart-related emphasis; status and urgency badges are encapsulated in shared components.
- **Brand:** `BrandLogo.tsx` is the reusable brand mark.
- **Icons:** `lucide-react`.
- **Shared primitives:** alert, badge, button, card, input, progress, select, table.
- **Shared domain components:** `BloodTypeBadge`, `MetricCard`, `ResolutionPipelineStepper`, `RouteTrackingMap`, `StatusBadge`, `UrgencyBadge`.

## 3. Layout and navigation
- Public pages include landing, login, OTP verification, role selection, signup, about, FAQ, contact, terms and privacy.
- Authenticated pages use `AppShell` with top header, desktop workspace sidebar, mobile menu, profile/sign-out controls and unread-notification badge.
- Role navigation is selected from the trusted profile role: hospital, blood bank, donor, and admin/regulator paths.
- Main workspace content is constrained to a centered maximum width and adapts padding across breakpoints.

## 4. UX behavior
- Auth initialization shows a “Preparing LIFE-LINK...” loading state.
- Missing/inactive profiles route to dedicated unprovisioned/inactive pages.
- Unauthenticated access to non-public paths redirects to login.
- Unread notification count refreshes on a 30-second interval and is intentionally non-blocking.
- Shared badges/stepper should be used for consistent state and urgency presentation.

## 5. Interaction/accessibility rules for future work
- Keep keyboard focus visible; every icon-only button needs an accessible name.
- Use semantic headings, labels linked to form controls, and clear validation messages.
- For critical actions, confirm destructive transitions and clearly show pending/success/failure states.
- Do not encode status using color alone; include text.
- Make map/tracking experiences usable without color-only cues and provide non-map status/timeline information.
- Keep mobile controls reachable and prevent menu overlays from trapping users unexpectedly.
- Do not expose personal donor location or sensitive profile details beyond authorized workflows.

## 6. Design review checklist
- Reuse existing shared primitives before creating duplicates.
- Match existing spacing, typography, colors and responsive breakpoints.
- Include loading, empty, error, unauthorized, inactive and offline/network-failure states where relevant.
- Verify keyboard navigation, accessible labels, contrast and responsive behavior.
- Ensure UI permissions align with backend authorization, but never rely on UI gating for security.

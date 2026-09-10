# 18 — App Store / Play Store Preparation Checklist

This is a checklist, not a claim of completion. Every row is marked
honestly against what actually exists in the repo today — checked
directly (icons opened and inspected, files searched for), not assumed.
**No legal document (privacy policy, terms of service) has been drafted
or reviewed by counsel** — nothing in this repo should be submitted to
an app store as-is on the legal-compliance front.

## 1. Current mobile packaging

A single Capacitor Android project exists at `frontend/android/`
(`capacitor.config.ts`: `appId: "com.rivo.app"`, `appName: "RIVO"`),
wrapping the same React SPA that serves web — passenger, driver, and
admin views are all role-gated routes within one app bundle
(`frontend/src/App.tsx`), not three separate builds.

**Decision needed before store submission**: ride-hailing platforms
usually ship the passenger and driver apps as two separate store
listings (different audiences, different review guidelines apply to
each — e.g. background location for drivers is scrutinized differently
than for passengers). Splitting this into two Capacitor
projects/appIds/builds sharing the same `frontend/src` is a build-config
change, not a code rewrite, since the role-gating already exists — but
it hasn't been done. This checklist covers both app "profiles" against
the current single build; treat the passenger/driver sections as what
each *listing* would need whether shipped as one app or two.

## 2. Checklist

| Item | Passenger app | Driver app | Status |
|---|---|---|---|
| App name | RIVO | RIVO Driver (if split) | ⚠️ Placeholder (`RIVO`) — needs a final decision on branding for a split build |
| Short description | — | — | ❌ Not written |
| Full store description | — | — | ❌ Not written |
| Screenshots | — | — | ❌ None captured. The design system (`docs/11-design-system.md`) and the actual running screens (`frontend/src/pages/passenger/`, `frontend/src/pages/driver/`) are the source to capture them from once ready |
| App icon | Default Capacitor placeholder icon (generic blue mark) — confirmed by opening `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` | same | ❌ Needs the real RIVO mark (`frontend/src/components/Logo.tsx` has the in-app logo component — export it to the icon sizes Android/iOS require) |
| Splash screen | Default Capacitor placeholder | same | ❌ Needs branded splash matching `Logo`/design tokens |
| Privacy policy | — | — | ❌ **Not drafted.** No file matching "privacy" exists anywhere in the repo (checked). Required before submission to either store. Must be reviewed by counsel before publishing — this repo will not generate one and call it done |
| Terms of service | — | — | ❌ **Not drafted.** Same caveat as privacy policy |
| Support contact info | — | — | ❌ Not published anywhere yet — the in-app Support Center (`frontend/src/pages/*/support` flows, backend `api/support/`) exists for in-app tickets, but a public support email/URL for the store listing hasn't been decided |
| Permission explanations | Location ("find nearby drivers, track your ride") | Location, incl. background ("track your position while online so passengers get matched to you"), camera (document upload for verification) | ⚠️ Permissions are *used* correctly in-app (see `frontend/src/pages/driver/DriverHome.tsx`'s geolocation handling with explicit permission-denied messaging) but the store-listing-facing plain-language explanations required by both stores haven't been written |
| Data safety / App Privacy declarations (Play Console / App Store Connect forms) | — | — | ❌ Not filled in. This requires an accurate inventory of what's collected — `docs/15-production-configuration.md` and the schema (`backend/prisma/schema.prisma`) are the source of truth for what's actually stored (phone, location while online, payment method type — never raw card numbers, ride history) |
| Age rating | — | — | ❌ Not determined |
| Build signing (Android keystore) | — | — | ❌ No release keystore configured — `android/` currently only has debug-build tooling from `npx cap add android` |
| iOS project | — | — | ❌ Does not exist. `npx cap add ios` has not been run; no Xcode project in the repo |

## 3. What genuinely is ready to build on

- The web app itself is production-buildable (`frontend/build` succeeds
  clean — verified as part of Phase 4's CI setup, `docs/16-cicd.md`).
- Role-based routing (`ProtectedRoute`, `AuthContext`) already separates
  passenger/driver/admin experiences cleanly, which is exactly the seam
  a two-app split would use.
- The design system (`docs/11-design-system.md`) defines the visual
  language a real icon/splash/screenshot set would be produced from —
  no guessing needed on brand colors/typography.
- In-app permission handling (geolocation errors, document upload for
  driver verification) is real and tested, which is what the store
  review process actually checks against the *listing's* permission
  explanations — so writing those explanations is a documentation task,
  not an engineering one.

## 4. Next steps, roughly in order

1. Decide: one app or two (passenger + driver split) — a product
   decision, not a technical blocker either way.
2. Commission real app icon + splash assets from the `Logo` component's
   mark.
3. Draft privacy policy + terms of service **with actual legal review**
   — describing real data practices from §2/`docs/15`, not generic
   boilerplate.
4. Capture real screenshots from the running app once the above visual
   assets exist.
5. Set up release signing (Android keystore; Apple Developer account +
   provisioning if shipping iOS).
6. Fill in the Play Console Data Safety form and App Store Connect
   Privacy Nutrition Label from the real schema, matched against the
   privacy policy from step 3 so they agree with each other.

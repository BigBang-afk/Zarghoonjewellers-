# 11 — Design System

## 1. Brand

**RIVO** — *"Your Ride. Your Price. Your Choice."*

A premium, trustworthy, map-centric mobility brand. Not playful, not
corporate-cold — closer to a fintech/travel product than a dispatch utility,
because the negotiation model asks users to think about price, not just tap
"book."

Voice: direct, confident, short sentences. "Your Price," not "flexible
pricing options." Numbers (fares, ETAs, ratings) are always rendered in the
display typeface at higher weight — price is a first-class visual citizen.

## 2. Logo concept

`Logo.tsx` (`apps/web/src/components/Logo.tsx`) implements the mark used
throughout the app:

- A rounded-square badge in the primary gradient (violet → indigo).
- An abstract **"R"** built from a location-pin-like stroke, so the wordmark's
  first letter doubles as a place marker.
- A small gold dot at the top-right, standing in for the "price" accent —
  the same gold used for fare emphasis and the "Set Your Price" affordance
  everywhere else in the product.
- Wordmark: **RIVO**, set in Manrope ExtraBold, tight tracking, all caps.

Two variants ship: `mark` (badge only, for favicons/nav-collapsed states) and
`full` (badge + wordmark, default). A `tone="light"` variant flips the
wordmark to white for dark surfaces (e.g. the admin sidebar).

## 3. Color system

Defined as design tokens in `apps/web/src/index.css` (Tailwind v4 `@theme`),
not ad-hoc hex values in components.

| Token | Hex | Usage |
|---|---|---|
| `rivo-600` | `#5B3FE0` | Primary brand — CTAs, active states, links |
| `rivo-500` | `#6C4EF2` | Hover/lighter accents, focus rings |
| `rivo-50…950` | | Full ramp for tints/shades, brand-tinted surfaces |
| `gold-400` | `#FFB02E` | Price emphasis, "Set Your Price" mode, driver earnings accents |
| `gold-50…900` | | Full ramp |
| `ink-900` | `#0B0D12` | Primary text, dark surfaces (admin sidebar, dark map, footer) |
| `ink-500…950` | | Neutral ramp for text/borders/dark surfaces |
| `success-500/600` | `#1FB463` / `#16994F` | Online, verified, completed, positive deltas |
| `danger-500/600` | `#E5484D` / `#D13438` | Cancelled, decline, destructive actions |
| `warning-500` | `#F5A623` | Pending, launching, attention states |

Rules:
- Gold is reserved for **price and earnings** contexts — using it elsewhere
  dilutes the "your price" signal.
- Status color (success/danger/warning) is never the *only* signal — every
  status badge pairs color with a text label (see Badge component), for
  colorblind accessibility.
- Dark surfaces (ink-900) are used sparingly and deliberately: the admin
  sidebar (professional, data-dense context) and the safety/trust section of
  the landing page (gravity) — the core booking flow stays light and airy.

## 4. Typography

- **Display** — Manrope (600–800 weight): headlines, prices, KPI numbers,
  the logo wordmark. Confident, geometric, slightly rounded — feels modern
  without being playful.
- **Body / UI** — Inter (400–700 weight): everything else — labels, body
  copy, form inputs, table content. Best-in-class legibility at small sizes,
  which matters for dense driver-request cards and the admin table.
- Numbers that matter (fares, ratings, KPIs) always use tabular figures and
  the display face at extrabold weight — a Rs 700 fare should never look
  like incidental UI text.

## 5. Components

Shared primitives in `apps/web/src/components/ui/`, used identically across
all four Phase 1 screens (one visual language, not four):

- **Button** (`Button.tsx`) — 5 variants (`primary`, `secondary`, `ghost`,
  `danger`, `gold`) × 3 sizes. `gold` variant is reserved for
  price/earnings-related primary actions (Set Your Price, Drive with RIVO,
  driver counter-offer).
- **Card** (`Card.tsx`) — the base surface: white, subtle border, soft
  shadow. Every content block (KPI tile, driver card, request sheet) is a
  `Card`.
- **Badge** (`Badge.tsx`) — status pill, 5 tones (`neutral`, `success`,
  `danger`, `warning`, `brand`), optional dot. Used for ride status, driver
  verification, city status, booking mode.
- **MapCanvas / MapPin / CarMarker** (`MapCanvas.tsx`) — the stylized mock
  map surface shared by Customer Home, Driver Home, the landing page hero
  and safety section, and the Admin Live Map. One visual map language, not
  a different illustration per screen. Explicitly a design placeholder for
  a real maps SDK (Mapbox/Google Maps) — see
  [06 — Technical Architecture](./06-technical-architecture.md).
- **VehicleIcon** (`VehicleIcon.tsx`) — maps a `VehicleTypeId` to a
  consistent icon (bike, rickshaw, car, premium/crown) everywhere vehicle
  type is shown.

## 6. Navigation patterns

- **Mobile apps** (Customer/Driver): bottom tab bar, 4 items, icon + label,
  active tab in `rivo-600`. Primary content lives in a map + bottom-sheet
  pattern — the map is never fully obscured.
- **Admin dashboard**: fixed left sidebar, grouped by section (Overview /
  Operations / Finance / Trust & Safety / Configuration / System), dark
  (`ink-900`) to visually separate "control panel" from the light content
  area — a deliberate contrast with the passenger/driver apps' light,
  approachable surfaces.

## 7. Maps

A consistent **stylized mock map** (`MapCanvas`) stands in for a real maps
SDK across every screen: a soft lavender/dark grid of blocks, two major
roads, one diagonal avenue, a park patch — recognizable as "a map" without
implying live tile data. Pins (`MapPin`) differentiate pickup (violet),
destination (ink/black), and "you" (pulsing violet dot). Driver vehicles
(`CarMarker`) are white discs with a dark glyph, rotated to a heading.

## 8. Status badges

| Status | Tone | Example |
|---|---|---|
| Online / Completed / Verified | `success` (green) | driver availability, ride completed |
| In progress / Quick Match / Live | `brand` (violet) | active ride, booking mode |
| Requested / Pending / Launching | `warning` (gold) | new request, city launching |
| Cancelled / Declined | `danger` (red) | cancelled ride, declined request |
| Default / neutral counts | `neutral` (grey) | secondary metadata |

## 9. Dialogs & sheets

The negotiation-heavy flows (driver request, counter-offer) use a **bottom
sheet over a dimmed map**, not a modal dialog box — keeps spatial context
(the map) visible while a decision is made, appropriate for a location-first
product. Admin, being desktop/data-dense, uses in-page panels rather than
sheets.

## 10. Empty, loading, and error states

Established patterns for Phase 2 build-out, consistent with what's already
in Phase 1:

- **Empty**: icon in a tinted rounded-square (matches the `PlaceholderSection`
  pattern used for admin nav stubs) + one-sentence explanation + a primary
  action where relevant. Never a bare "No data."
- **Loading**: skeleton blocks matching the target layout's shape (card
  outlines, table row bars) rather than a centered spinner, so layout
  doesn't jump on load.
- **Error**: same tinted rounded-square pattern, `danger`-toned icon, plain-
  language message (never a raw error code) with a retry action; the
  underlying `code` from the [API error contract](./09-api-architecture.md)
  is logged, not shown.

## 11. Motion

Smooth, fast, purposeful — never decorative. 150ms color/opacity
transitions on interactive elements (buttons, nav items, cards); a subtle
pulse on the "you are here" map pin and the driver's "online" indicator to
signal liveness without being distracting. No bouncing, no skeuomorphic
flourishes — motion communicates state change, not personality.

## 12. Accessibility

- Minimum 44×44px touch targets on all mobile interactive elements (buttons,
  tab bar items, request-card actions).
- Color is never the sole status signal (see § Status badges).
- Text contrast meets WCAG AA against both light (`#F6F5FB`) and dark
  (`ink-900`) surfaces at the weights used.
- Map pins and status dots carry text labels or accessible names, not just
  color-coded shapes.

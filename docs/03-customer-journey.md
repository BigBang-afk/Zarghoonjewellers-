# 03 — Customer Journey

End-to-end passenger flow across all 36 customer screens (see
[02 — Feature Map](./02-feature-map.md)). 🟢 marks what's built in Phase 1.

## A. Onboarding & auth

1. **Splash** — brand mark, auto-advances.
2. **Onboarding** — 3-slide carousel: "Get matched instantly", "Set your own price",
   "Track every ride live". Skippable.
3. **Login** — phone number entry (primary), fallback email.
4. **Registration** — name, phone, email, referral code (optional).
5. **OTP verification** — 6-digit code, resend timer, auto-read on supported devices.

→ lands on **Home / Map**.

## B. Booking — 🟢 Home / Map (built)

The map-first home screen. Shows: current location pin, destination search bar,
saved places (Home/Work), recent destinations, wallet balance, notifications.
Selecting a destination reveals:

7. **Pickup selection** — defaults to current GPS location, draggable pin to adjust
   (in the built screen, pickup is implicitly "current location"; a dedicated
   pickup-adjust screen is Phase 2).
8. **Destination selection** — search or pick from recents/saved (🟢 built inline).
9. **Ride type** — vehicle type carousel: Bike, Rickshaw, Economy, Standard, Premium,
   each showing ETA and a suggested fare (🟢 built inline).
10. **Fare suggestion** — the platform-computed fare shown per vehicle type, sourced
    from the Fare Engine (🟢 built inline, static in Phase 1).
11. **Custom fare** — stepper to raise/lower the offer from the suggested fare, shown
    when Competitive Offer mode is selected (🟢 built inline).
12. **Quick Match** — one tap confirms and books the best-matched driver at the
    suggested fare (🟢 entry point built; matching itself is Phase 2 backend work).
13. **Competitive Offer** — one tap sends the custom fare to nearby drivers (🟢 entry
    point built).

## C. Matching & offer comparison (Phase 2)

14. **Searching for drivers** — animated radar/pulse around the pickup pin, live
    count of drivers notified, cancel option.
15. **Driver offers** — list of accepted/counter-offer cards streaming in in
    real time, each with price, ETA, rating (data model and card design
    established in [11 — Design System](./11-design-system.md); this is the same
    card component used for [driver comparison](#driver-comparison-card)).
16. **Compare drivers** — side-by-side or sortable list (price / ETA / rating).
17. **Driver profile** — tapping a card opens full profile: photo, rating breakdown,
    completed rides, vehicle, verification badges.
18. **Ride confirmation** — final fare, driver, vehicle, pickup/destination recap,
    confirm button.

### Driver comparison card

Every driver offer card shows: driver name, photo, rating, completed rides,
verification status, vehicle + model + color, plate, offer price, ETA, distance
from passenger, and cancellation rate — see the `DriverOffer` shape in
`apps/web/src/data/mock.ts` and [08 — Database Schema](./08-database-schema.sql)
(`ride_offers`, `counter_offers`).

## D. In-ride

19. **Live ride tracking** — driver's live position, route line, ETA to
    destination, driver/vehicle summary bar.
20. **Safety center** — one tap from tracking: emergency contacts, share trip,
    SOS, report issue.
21. **Share trip** — generates a live-tracking link for a trusted contact.
22. **Emergency assistance UI** — SOS button → confirms → alerts safety team +
    optionally local emergency services, logs a `SafetyEvent`.
23. **Chat** — in-app text thread with the driver, template quick-replies.
24. **Call driver** — masked-number call (driver's real number never exposed).

## E. Completion

25. **Payment** — charges the selected method (cash confirmation, or card/wallet
    capture).
26. **Receipt** — fare breakdown (base + distance + time − promo + commission
    note), route map, timestamps.
27. **Rating / review** — 1–5 stars + optional tags/comment for the driver.

## F. Account

28. **Ride history** — list of past rides, filterable by date/status, tap for
    receipt.
29. **Saved places** — manage Home/Work/custom saved addresses.
30. **Notifications** — system, promo, and ride-status notifications.
31. **Wallet** — balance, top-up, linked payment methods, transaction list.
32. **Promo codes** — enter/apply a code, see active promotions.
33. **Profile** — name, photo, phone/email, verification status.
34. **Settings** — language, notification preferences, privacy, linked devices.
35. **Help / support** — FAQ, contact support, ticket status.
36. **Dispute / report issue** — file a dispute against a specific ride/charge.

## Mode selection — where it happens

The passenger picks **Quick Match** vs **Competitive Offer** *after* choosing a
destination and vehicle type, as two equally-weighted buttons on Home — never a
locked account-level setting. This is the core differentiator surfaced directly
in the primary flow (🟢 built exactly this way in `CustomerHome.tsx`).

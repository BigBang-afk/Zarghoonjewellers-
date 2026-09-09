# 04 — Driver Journey

End-to-end driver flow across all 30 driver screens (see
[02 — Feature Map](./02-feature-map.md)). 🟢 marks what's built in Phase 1.

## A. Onboarding & verification

1. **Driver onboarding** — intro flow, requirements checklist (age, license,
   vehicle eligibility for the city).
2. **Phone verification** — OTP, same pattern as passenger.
3. **Identity verification workflow** — government ID capture (front/back) +
   liveness selfie, submitted to `driver_documents` for admin review.
4. **Driving-license information** — license number, expiry, upload.
5. **Vehicle registration** — make, model, year, plate, color, vehicle type
   (must map to a `vehicle_types` row enabled in the driver's city).
6. **Vehicle documents** — registration certificate, insurance, route permit
   where applicable.
7. **Vehicle photos** — front/back/side/interior.
8. **Profile** — photo, bio, languages spoken.

All documents enter `pending` status and are reviewed in the Admin
**Driver Verification** queue ([05 — Admin Journey](./05-admin-journey.md)) before
the driver can go online.

## B. Going online — 🟢 Driver Home / Map (built)

9. **Availability toggle** — a single prominent online/offline control; going
   online starts location broadcast and request eligibility (🟢 built).
10. **Driver home / map** — live map, current position, nearby demand, earnings
    strip (today's total, ride count, online hours, rating) (🟢 built).

## C. Handling a request — 🟢 built as an in-context sheet

11. **Incoming ride request** — a request card slides up over the map showing:
    passenger name + rating, pickup, destination, distance, estimated trip
    time, proposed fare, vehicle requirement, payment method (🟢 built).
12. **Competitive offers** — when in Competitive Offer mode, the driver sees the
    passenger's proposed fare next to the platform-suggested fare before
    deciding (🟢 `suggestedFare` shown in mock data; surfaced explicitly in
    Phase 2 UI).
13. **Accept request** — one tap locks the driver to that ride at the proposed
    fare (🟢 built).
14. **Counter-offer** — stepper to propose a different fare, sent back to the
    passenger with an expiry timer; driver waits for accept/continue-waiting/
    cancel from the passenger (🟢 built, expiry timer is Phase 2 backend work).
15. **Passenger information** — shown inline on the request card: name, rating
    (🟢 built).
16. **Decline** — removes the driver from this request's candidate pool without
    penalizing acceptance-rate the way an accept-then-cancel would.

## D. Executing the ride (Phase 2)

16. **Navigation** — turn-by-turn to pickup, then to destination.
17. **Arrived** — manual or geofence-triggered "I've arrived" notifies the
    passenger and starts a wait timer.
18. **Start ride** — confirmed once passenger is picked up (optionally via a
    shared PIN/QR check for verification).
19. **Active ride** — live trip screen: route, ETA, fare running total, chat/call
    access, emergency button.
20. **End ride** — confirms drop-off, triggers fare finalization and payment
    capture.

## E. Earnings & account

21. **Earnings** — today/week/month breakdown, per-ride list (🟢 today's summary
    strip built on Home; full breakdown is Phase 2).
22. **Wallet** — available balance, pending payouts.
23. **Withdrawals** — request a payout to a bank/mobile-wallet method.
24. **Transaction history** — every credit/debit (fares, commission, adjustments,
    withdrawals).
25. **Ratings** — rating trend, breakdown by tag (safety, cleanliness, etc.).
26. **Performance analytics** — acceptance rate, cancellation rate, completion
    rate, streaks/incentives progress.
27. **Ride history** — past rides, filterable, tap for detail.
28. **Notifications** — system, incentive, and dispute notifications.
29. **Support** — FAQ, contact support, ticket status.
30. **Settings** — language, notification preferences, vehicle switch (if the
    driver has multiple registered vehicles).

## Accept / Counter / Decline — the driver-side negotiation contract

Every incoming request, regardless of booking mode, resolves to exactly one of:

- **Accept** → `ride_offers.status = accepted` → ride is created.
- **Counter** → `counter_offers` row created with an expiry → passenger notified.
- **Decline** → driver removed from this request's candidate list, no rating
  impact; a pattern of declines still feeds acceptance-rate analytics used by
  the Matching Engine (see [06](./06-technical-architecture.md)).

This exact contract is what `DriverHome.tsx` implements for Phase 1.

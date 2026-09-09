# 02 — Feature Map

Complete screen inventory across the three RIVO surfaces. Screens marked **🟢 Built**
are implemented in `apps/web` for Phase 1; everything else is specified in the journey
docs ([03](./03-customer-journey.md), [04](./04-driver-journey.md),
[05](./05-admin-journey.md)) for later phases.

## Customer app (36 screens)

| # | Screen | Phase 1 |
|---|--------|---------|
| 1 | Splash | |
| 2 | Onboarding | |
| 3 | Login | |
| 4 | Registration | |
| 5 | OTP verification | |
| 6 | Home / Map | 🟢 Built |
| 7 | Pickup selection | |
| 8 | Destination selection | |
| 9 | Ride type | |
| 10 | Fare suggestion | |
| 11 | Custom fare | |
| 12 | Quick Match | |
| 13 | Competitive Offer | |
| 14 | Searching for drivers | |
| 15 | Driver offers | |
| 16 | Compare drivers | |
| 17 | Driver profile | |
| 18 | Ride confirmation | |
| 19 | Live ride tracking | |
| 20 | Safety center | |
| 21 | Share trip | |
| 22 | Emergency assistance UI | |
| 23 | Chat | |
| 24 | Call driver | |
| 25 | Payment | |
| 26 | Receipt | |
| 27 | Rating / review | |
| 28 | Ride history | |
| 29 | Saved places | |
| 30 | Notifications | |
| 31 | Wallet | |
| 32 | Promo codes | |
| 33 | Profile | |
| 34 | Settings | |
| 35 | Help / support | |
| 36 | Dispute / report issue | |

Screens 7–13 (pickup, destination, ride type, fare suggestion, custom fare, Quick
Match, Competitive Offer) are collapsed into the single **Home / Map** screen for
Phase 1 as an integrated flow (search → vehicle → mode), rather than built as
separate routes — see [03 — Customer Journey](./03-customer-journey.md).

## Driver app (30 screens)

| # | Screen | Phase 1 |
|---|--------|---------|
| 1 | Driver onboarding | |
| 2 | Phone verification | |
| 3 | Identity verification workflow | |
| 4 | Driving-license information | |
| 5 | Vehicle registration | |
| 6 | Vehicle documents | |
| 7 | Vehicle photos | |
| 8 | Profile | |
| 9 | Availability toggle | 🟢 Built (on Home) |
| 10 | Driver home / map | 🟢 Built |
| 11 | Incoming ride request | 🟢 Built (on Home) |
| 12 | Competitive offers | |
| 13 | Accept request | 🟢 Built (on Home) |
| 14 | Counter-offer | 🟢 Built (on Home) |
| 15 | Passenger information | 🟢 Built (on request card) |
| 16 | Navigation | |
| 17 | Arrived | |
| 18 | Start ride | |
| 19 | Active ride | |
| 20 | End ride | |
| 21 | Earnings | 🟢 Built (summary strip) |
| 22 | Wallet | |
| 23 | Withdrawals | |
| 24 | Transaction history | |
| 25 | Ratings | |
| 26 | Performance analytics | |
| 27 | Ride history | |
| 28 | Notifications | |
| 29 | Support | |
| 30 | Settings | |

## Admin web dashboard (26 sections)

| # | Section | Phase 1 |
|---|---------|---------|
| 1 | Dashboard | 🟢 Built |
| 2 | Live Map | 🟢 Built (on Dashboard) |
| 3 | Passengers | Nav stub |
| 4 | Drivers | Nav stub |
| 5 | Driver Verification | Nav stub (badge count shown) |
| 6 | Vehicles | Nav stub |
| 7 | Ride Requests | Nav stub |
| 8 | Active Rides | Nav stub |
| 9 | Completed Rides | Nav stub |
| 10 | Cancelled Rides | Nav stub |
| 11 | Payments | Nav stub |
| 12 | Commissions | Nav stub |
| 13 | Promotions | Nav stub |
| 14 | Support | Nav stub |
| 15 | Disputes | Nav stub |
| 16 | Safety | Nav stub |
| 17 | Fraud / Risk | Nav stub |
| 18 | Cities | 🟢 Built (panel on Dashboard) |
| 19 | Service Areas | Nav stub |
| 20 | Pricing | Nav stub |
| 21 | Analytics | Nav stub |
| 22 | Reports | Nav stub |
| 23 | Notifications | Nav stub |
| 24 | Admin Users | Nav stub |
| 25 | Settings | Nav stub |
| 26 | Audit Logs | Nav stub |

"Nav stub" = present and navigable in the sidebar with a labeled placeholder panel,
full workspace ships in a later phase — this is disclosed in-product rather than
faked.

## Cross-cutting engines (not screens — see [06](./06-technical-architecture.md))

- Fare Engine
- Negotiation Engine
- Matching Engine
- Real-time event system
- Safety event pipeline
- Fraud/risk scoring

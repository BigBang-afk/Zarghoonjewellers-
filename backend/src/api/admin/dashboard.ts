import { Router } from "express"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { getSetting } from "../../config/settings.js"
import { haversineKm } from "../../utils/geo.js"
import { roundMoney } from "../../utils/money.js"

export const adminDashboardRouter = Router()

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Real database aggregates — no placeholder numbers once seed/live data
 * exists (Phase 2 §17: "Do NOT use fake numbers once database data
 * exists"). Every figure here is a live Prisma count/aggregate.
 */
adminDashboardRouter.get(
  "/dashboard/kpis",
  asyncHandler(async (req, res) => {
    const cityId = req.query.cityId as string | undefined
    const todayFilter = { createdAt: { gte: startOfToday() } }
    const cityFilter = cityId ? { cityId } : {}
    const rideCityFilter = cityId ? { rideRequest: { cityId } } : {}
    // Money aggregates join back to the ride's city through the payment/
    // transaction relation — without this filter these figures silently
    // stayed platform-wide even when an admin filtered every other card
    // by city (Phase 5 §2: never mix currencies without saying so).
    const paymentCityFilter = cityId ? { ride: { rideRequest: { cityId } } } : {}
    const transactionCityFilter = cityId ? { payment: { ride: { rideRequest: { cityId } } } } : {}

    const [
      totalPassengers,
      activePassengers,
      totalDrivers,
      onlineDrivers,
      ridesRequestedToday,
      completedToday,
      cancelledToday,
      activeRides,
      gbvAgg,
      commissionAgg,
      driverPayoutAgg,
      fareAgg,
      pendingVerifications,
      city,
    ] = await Promise.all([
      prisma.passengerProfile.count({ where: cityId ? { user: { primaryCityId: cityId } } : {} }),
      prisma.passengerProfile.count({ where: { user: { status: "active", ...(cityId ? { primaryCityId: cityId } : {}) } } }),
      prisma.driverProfile.count({ where: { deletedAt: null, ...cityFilter } }),
      prisma.driverProfile.count({ where: { availabilityStatus: "online", ...cityFilter } }),
      prisma.rideRequest.count({ where: { ...cityFilter, ...todayFilter } }),
      prisma.ride.count({ where: { status: "ride_completed", ...rideCityFilter, ...todayFilter } }),
      prisma.ride.count({ where: { status: { in: ["cancelled_by_passenger", "cancelled_by_driver"] }, ...rideCityFilter, ...todayFilter } }),
      prisma.ride.count({ where: { status: { notIn: ["ride_completed", "cancelled_by_passenger", "cancelled_by_driver", "expired", "disputed"] }, ...rideCityFilter } }),
      prisma.payment.aggregate({ _sum: { amount: true }, where: { status: "captured", ...paymentCityFilter } }),
      prisma.commission.aggregate({ _sum: { amount: true }, where: { payment: { status: "captured", ...paymentCityFilter } } }),
      prisma.transaction.aggregate({ _sum: { amount: true }, where: { type: "ride_payout", ...transactionCityFilter } }),
      prisma.ride.aggregate({ _avg: { finalFare: true, durationMin: true }, where: { status: "ride_completed", ...rideCityFilter } }),
      prisma.driverProfile.count({ where: { verificationStatus: { in: ["pending", "under_review"] }, ...cityFilter } }),
      cityId ? prisma.city.findUnique({ where: { id: cityId }, select: { currencyCode: true } }) : Promise.resolve(null),
    ])

    const [driverCancelled, driverTotal, passengerCancelled, passengerTotal, repeatPassengers] = await Promise.all([
      prisma.ride.count({ where: { status: "cancelled_by_driver", ...rideCityFilter } }),
      prisma.ride.count({ where: rideCityFilter }),
      prisma.ride.count({ where: { status: "cancelled_by_passenger", ...rideCityFilter } }),
      prisma.ride.count({ where: rideCityFilter }),
      prisma.passengerProfile.count({ where: { completedRides: { gt: 1 }, ...(cityId ? { user: { primaryCityId: cityId } } : {}) } }),
    ])

    // A platform-wide view (no cityId) sums figures that may be in
    // different currencies — currencyCode comes back null rather than
    // pretending a single symbol applies (Phase 5 §2).
    const currencyCode = city?.currencyCode ?? null
    const roundFn = (n: number) => (currencyCode ? roundMoney(n, currencyCode) : round2(n))

    res.json({
      currencyCode,
      totalPassengers,
      activePassengers,
      totalDrivers,
      onlineDrivers,
      ridesRequestedToday,
      completedToday,
      cancelledToday,
      activeRides,
      grossBookingValueRs: roundFn(gbvAgg._sum.amount ?? 0),
      platformRevenueRs: roundFn(commissionAgg._sum.amount ?? 0),
      driverEarningsRs: roundFn(driverPayoutAgg._sum.amount ?? 0),
      avgFareRs: roundFn(fareAgg._avg.finalFare ?? 0),
      avgDurationMin: round2(fareAgg._avg.durationMin ?? 0),
      driverCancellationRatePct: driverTotal ? round2((driverCancelled / driverTotal) * 100) : 0,
      passengerCancellationRatePct: passengerTotal ? round2((passengerCancelled / passengerTotal) * 100) : 0,
      repeatPassengerRatePct: totalPassengers ? round2((repeatPassengers / totalPassengers) * 100) : 0,
      pendingDriverVerifications: pendingVerifications,
    })
  }),
)

adminDashboardRouter.get(
  "/live-map",
  asyncHandler(async (req, res) => {
    const cityId = req.query.cityId as string | undefined
    const stalenessMinutes = await getSetting("matching.locationStalenessMinutes")
    const staleCutoff = new Date(Date.now() - stalenessMinutes * 60_000)

    const [drivers, activeRides, pendingRequests] = await Promise.all([
      prisma.driverProfile.findMany({
        where: { availabilityStatus: { in: ["online", "on_trip"] }, ...(cityId ? { cityId } : {}), lastLat: { not: null } },
        select: { id: true, availabilityStatus: true, lastLat: true, lastLng: true, lastLocationAt: true },
      }),
      prisma.ride.findMany({
        where: { status: { notIn: ["ride_completed", "cancelled_by_passenger", "cancelled_by_driver", "expired", "disputed"] } },
        select: { id: true, status: true, pickup: { select: { lat: true, lng: true } }, destination: { select: { lat: true, lng: true } } },
      }),
      prisma.rideRequest.count({ where: { status: { in: ["searching", "offers_open"] }, ...(cityId ? { cityId } : {}) } }),
    ])

    res.json({
      drivers: drivers.map((d) => ({
        id: d.id,
        status: d.availabilityStatus,
        lat: d.lastLat,
        lng: d.lastLng,
        lastLocationAt: d.lastLocationAt,
        // Phase 3 §21: surfaces drivers whose location hasn't refreshed
        // recently, so ops can spot a dead/backgrounded app rather than
        // trusting a stale pin.
        locationStale: !d.lastLocationAt || d.lastLocationAt < staleCutoff,
      })),
      activeRides: activeRides.map((r) => ({ id: r.id, status: r.status, pickup: r.pickup, destination: r.destination })),
      pendingRequestsCount: pendingRequests,
      staleDriverCount: drivers.filter((d) => !d.lastLocationAt || d.lastLocationAt < staleCutoff).length,
    })
  }),
)

/**
 * Live demand heat-map (Phase 3 §4): a coarse lat/lng grid over the
 * city's currently-active area (bounded by where online drivers and open
 * requests actually are, not a fixed box), with per-cell demand ratio,
 * driver supply, and recent cancellation rate — all computed from real
 * rows, not simulated. Pricing itself still only ever moves through the
 * FareRule's admin-configured surge bounds (see fareEngine.ts); this
 * endpoint is read-only visibility, not a second pricing path.
 */
adminDashboardRouter.get(
  "/demand-map",
  asyncHandler(async (req, res) => {
    const cityId = req.query.cityId as string | undefined
    if (!cityId) return res.status(400).json({ error: { code: "CITY_REQUIRED", message: "cityId is required." } })
    // Zone boundaries (ServiceZone.boundaryGeoJson) aren't populated with
    // real polygon geometry yet in this system, so this can only filter
    // the rows that already carry a zoneId (ride requests/rides) — driver
    // positions have no zone tag to filter by. Documented, not hidden.
    const zoneId = req.query.zoneId as string | undefined

    const gridSize = Math.min(10, Math.max(2, Number(req.query.gridSize) || 5))
    // Time range (Phase 4 §9 / Phase 5 §11) — how far back "recent rides"
    // (completed + cancelled) looks; online drivers and open requests are
    // always current, since a past demand snapshot of who's online now
    // is meaningless.
    const range = (req.query.range as string) || "lastHour"
    const rideCreatedFilter = rideTimeRangeFilter(range)

    const [onlineDrivers, openRequests, recentRides, greenMaxRatio, yellowMaxRatio] = await Promise.all([
      prisma.driverProfile.findMany({
        where: { cityId, availabilityStatus: "online", lastLat: { not: null }, lastLng: { not: null } },
        select: { lastLat: true, lastLng: true },
      }),
      prisma.rideRequest.findMany({
        where: { cityId, status: { in: ["searching", "offers_open"] }, ...(zoneId ? { zoneId } : {}) },
        include: { pickup: { select: { lat: true, lng: true } } },
      }),
      prisma.ride.findMany({
        where: { rideRequest: { cityId, ...(zoneId ? { zoneId } : {}) }, createdAt: rideCreatedFilter },
        select: { status: true, pickup: { select: { lat: true, lng: true } } },
      }),
      getSetting("supplyDemand.greenMaxRatio"),
      getSetting("supplyDemand.yellowMaxRatio"),
    ])

    const points = [
      ...onlineDrivers.map((d) => ({ lat: d.lastLat!, lng: d.lastLng! })),
      ...openRequests.map((r) => ({ lat: r.pickup.lat, lng: r.pickup.lng })),
      ...recentRides.map((r) => ({ lat: r.pickup.lat, lng: r.pickup.lng })),
    ]
    if (points.length === 0) return res.json({ cells: [], gridSize, range, zoneId: zoneId ?? null })

    const lats = points.map((p) => p.lat)
    const lngs = points.map((p) => p.lng)
    const minLat = Math.min(...lats), maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
    const latStep = (maxLat - minLat || 0.01) / gridSize
    const lngStep = (maxLng - minLng || 0.01) / gridSize

    function cellIndex(lat: number, lng: number) {
      const row = Math.min(gridSize - 1, Math.floor((lat - minLat) / latStep))
      const col = Math.min(gridSize - 1, Math.floor((lng - minLng) / lngStep))
      return `${row}:${col}`
    }

    const cells = new Map<string, { row: number; col: number; onlineDrivers: number; openRequests: number; completedRides: number; cancelledRides: number }>()
    function getCell(row: number, col: number) {
      const key = `${row}:${col}`
      if (!cells.has(key)) cells.set(key, { row, col, onlineDrivers: 0, openRequests: 0, completedRides: 0, cancelledRides: 0 })
      return cells.get(key)!
    }

    for (const d of onlineDrivers) {
      const [row, col] = cellIndex(d.lastLat!, d.lastLng!).split(":").map(Number)
      getCell(row, col).onlineDrivers++
    }
    for (const r of openRequests) {
      const [row, col] = cellIndex(r.pickup.lat, r.pickup.lng).split(":").map(Number)
      getCell(row, col).openRequests++
    }
    for (const r of recentRides) {
      const [row, col] = cellIndex(r.pickup.lat, r.pickup.lng).split(":").map(Number)
      const cell = getCell(row, col)
      if (r.status === "ride_completed") cell.completedRides++
      if (r.status === "cancelled_by_passenger" || r.status === "cancelled_by_driver") cell.cancelledRides++
    }

    const cancellationThreshold = await getSetting("risk.cancellationRateThresholdPct")

    const result = [...cells.values()].map((c) => {
      const demandRatio = c.openRequests / Math.max(1, c.onlineDrivers)
      const totalRecentRides = c.completedRides + c.cancelledRides
      const cancellationRatePct = totalRecentRides ? round2((c.cancelledRides / totalRecentRides) * 100) : 0
      // Traffic-light status (Phase 5 §10) — admin-configurable, not
      // hard-coded: a cell with open requests but zero drivers is red
      // regardless of ratio (a ratio against zero supply understates how
      // bad it is), otherwise the ratio decides.
      const status: "green" | "yellow" | "red" =
        c.onlineDrivers === 0 && c.openRequests > 0
          ? "red"
          : demandRatio <= greenMaxRatio
            ? "green"
            : demandRatio <= yellowMaxRatio
              ? "yellow"
              : "red"
      return {
        row: c.row,
        col: c.col,
        centerLat: round2(minLat + latStep * (c.row + 0.5)),
        centerLng: round2(minLng + lngStep * (c.col + 0.5)),
        onlineDrivers: c.onlineDrivers,
        openRequests: c.openRequests,
        demandRatio: round2(demandRatio),
        cancellationRatePct,
        status,
        flags: {
          highDemand: demandRatio > yellowMaxRatio,
          lowSupply: c.onlineDrivers === 0 && c.openRequests > 0,
          highCancellation: totalRecentRides >= 3 && cancellationRatePct >= cancellationThreshold,
        },
      }
    })

    res.json({ cells: result, gridSize, range, zoneId: zoneId ?? null, thresholds: { greenMaxRatio, yellowMaxRatio }, bounds: { minLat, maxLat, minLng, maxLng } })
  }),
)

/**
 * Live operations summary (Phase 3 §21) — the single "what needs my
 * attention right now" view: active rides, pending requests, online vs
 * stale-location drivers, today's cancellations, and open safety/dispute
 * items, all filterable by city/vehicle type/time window.
 */
adminDashboardRouter.get(
  "/live-ops/summary",
  asyncHandler(async (req, res) => {
    const { cityId, vehicleTypeId, sinceHours = "24" } = req.query as Record<string, string>
    const since = new Date(Date.now() - (Number(sinceHours) || 24) * 3_600_000)
    const stalenessMinutes = await getSetting("matching.locationStalenessMinutes")
    const staleCutoff = new Date(Date.now() - stalenessMinutes * 60_000)

    const cityFilter = cityId ? { cityId } : {}
    const vehicleTypeFilter = vehicleTypeId ? { vehicleTypeId } : {}
    const rideRequestFilter = { ...cityFilter, ...vehicleTypeFilter }

    const [
      activeRides,
      pendingRequests,
      onlineDrivers,
      staleDrivers,
      cancellationsInWindow,
      openSafetyIncidents,
      openDisputes,
      openSupportTickets,
    ] = await Promise.all([
      prisma.ride.count({
        where: {
          status: { notIn: ["ride_completed", "cancelled_by_passenger", "cancelled_by_driver", "expired", "disputed"] },
          rideRequest: rideRequestFilter,
        },
      }),
      prisma.rideRequest.count({ where: { status: { in: ["searching", "offers_open"] }, ...rideRequestFilter } }),
      prisma.driverProfile.count({ where: { availabilityStatus: "online", ...cityFilter } }),
      prisma.driverProfile.count({ where: { availabilityStatus: { in: ["online", "on_trip"] }, ...cityFilter, OR: [{ lastLocationAt: null }, { lastLocationAt: { lt: staleCutoff } }] } }),
      prisma.ride.count({ where: { status: { in: ["cancelled_by_passenger", "cancelled_by_driver"] }, createdAt: { gte: since }, rideRequest: rideRequestFilter } }),
      prisma.safetyEvent.count({ where: { resolvedAt: null, createdAt: { gte: since } } }),
      prisma.dispute.count({ where: { status: { in: ["open", "under_review", "awaiting_info"] } } }),
      prisma.supportTicket.count({ where: { status: { in: ["open", "in_progress", "waiting"] } } }),
    ])

    res.json({
      windowHours: Number(sinceHours) || 24,
      activeRides,
      pendingRequests,
      onlineDrivers,
      staleLocationDrivers: staleDrivers,
      cancellationsInWindow,
      openSafetyIncidents,
      openDisputes,
      openSupportTickets,
      quickActions: [
        { label: "Review safety queue", endpoint: "GET /v1/admin/safety-events?resolved=false" },
        { label: "Review open disputes", endpoint: "GET /v1/admin/disputes?status=open" },
        { label: "Review support tickets", endpoint: "GET /v1/admin/support-tickets?status=open" },
        { label: "View live map", endpoint: "GET /v1/admin/live-map" },
      ],
    })
  }),
)

/**
 * Driver supply dashboard (Phase 4 §8) — a real-time headcount plus a
 * couple of computed, honestly-labeled operational alerts (never a
 * guarantee, per the spec) grounded in actual pickup locations and
 * driver positions rather than a fabricated zone map.
 */
adminDashboardRouter.get(
  "/supply/dashboard",
  asyncHandler(async (req, res) => {
    const { cityId, zoneId } = req.query as Record<string, string>
    const cityFilter = cityId ? { cityId } : {}
    // Driver supply isn't zone-tagged (see the demand-map endpoint's note
    // on ServiceZone.boundaryGeoJson not carrying real geometry yet) — a
    // zoneId filter here only narrows the open-requests side.
    const requestZoneFilter = zoneId ? { zoneId } : {}
    const stalenessMinutes = await getSetting("matching.locationStalenessMinutes")
    const staleCutoff = new Date(Date.now() - stalenessMinutes * 60_000)
    const searchRadiusKm = await getSetting("matching.initialRadiusKm")
    const yellowMaxRatio = await getSetting("supplyDemand.yellowMaxRatio")

    const [onlineDriverRows, busyCount, offlineCount, awaitingVerification, openRequests] = await Promise.all([
      prisma.driverProfile.findMany({
        where: { availabilityStatus: "online", ...cityFilter },
        select: { id: true, lastLat: true, lastLng: true, lastLocationAt: true },
      }),
      prisma.driverProfile.count({ where: { availabilityStatus: "on_trip", ...cityFilter } }),
      prisma.driverProfile.count({ where: { availabilityStatus: "offline", ...cityFilter } }),
      prisma.driverProfile.count({ where: { verificationStatus: { in: ["pending", "under_review"] }, ...cityFilter } }),
      prisma.rideRequest.findMany({
        where: { status: { in: ["searching", "offers_open"] }, ...cityFilter, ...requestZoneFilter },
        include: { pickup: { select: { lat: true, lng: true, address: true } } },
        orderBy: { createdAt: "asc" },
        take: 20,
      }),
    ])

    const staleGpsCount = onlineDriverRows.filter((d) => !d.lastLocationAt || d.lastLocationAt < staleCutoff).length
    const positioned = onlineDriverRows.filter((d) => d.lastLat != null && d.lastLng != null && d.lastLocationAt! >= staleCutoff)
    // "Available" = online, positioned, and not already sitting on a
    // pending offer for some other request right now.
    const busyOnOffer = await prisma.rideOffer.findMany({ where: { status: "pending" }, select: { driverId: true } })
    const busyOnOfferIds = new Set(busyOnOffer.map((o) => o.driverId))
    const available = positioned.filter((d) => !busyOnOfferIds.has(d.id))

    const alerts: string[] = []
    if (openRequests.length > 0 && available.length > 0 && openRequests.length / available.length > yellowMaxRatio) {
      alerts.push(`Demand is high right now — ${openRequests.length} open requests against ${available.length} available drivers.`)
    } else if (openRequests.length > 0 && available.length === 0) {
      alerts.push(`${openRequests.length} open request${openRequests.length === 1 ? "" : "s"} and no available drivers right now.`)
    }
    for (const r of openRequests.slice(0, 5)) {
      const nearby = available.filter((d) => haversineKm(r.pickup, { lat: d.lastLat!, lng: d.lastLng! }) <= searchRadiusKm).length
      if (nearby < 3) {
        alerts.push(`Only ${nearby} available driver${nearby === 1 ? "" : "s"} within ${searchRadiusKm}km of a pickup near ${r.pickup.address}.`)
      }
    }

    const greenMaxRatio = await getSetting("supplyDemand.greenMaxRatio")
    const supplyDemandRatio = openRequests.length ? round2(openRequests.length / Math.max(1, available.length)) : 0
    const status: "green" | "yellow" | "red" =
      available.length === 0 && openRequests.length > 0
        ? "red"
        : supplyDemandRatio <= greenMaxRatio
          ? "green"
          : supplyDemandRatio <= yellowMaxRatio
            ? "yellow"
            : "red"

    res.json({
      onlineDrivers: onlineDriverRows.length,
      availableDrivers: available.length,
      busyDrivers: busyCount,
      offlineDrivers: offlineCount,
      staleGpsDrivers: staleGpsCount,
      driversAwaitingVerification: awaitingVerification,
      openRequestsCount: openRequests.length,
      supplyDemandRatio,
      status,
      alerts,
    })
  }),
)

/** Maps a demand-map "range" query param to a Prisma date filter (Phase 4 §9). */
function rideTimeRangeFilter(range: string): { gte: Date; lt?: Date } {
  const now = new Date()
  switch (range) {
    case "last15min":
      return { gte: new Date(now.getTime() - 15 * 60_000) }
    case "today": {
      const start = startOfToday()
      return { gte: start }
    }
    case "yesterday": {
      const start = startOfToday()
      const yesterdayStart = new Date(start.getTime() - 24 * 3_600_000)
      return { gte: yesterdayStart, lt: start }
    }
    case "last7days":
      return { gte: new Date(now.getTime() - 7 * 24 * 3_600_000) }
    case "lastHour":
    default:
      return { gte: new Date(now.getTime() - 3_600_000) }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

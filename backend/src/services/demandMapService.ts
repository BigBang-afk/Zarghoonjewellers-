import { prisma } from "../utils/prisma.js"
import { getSetting } from "../config/settings.js"

/**
 * Shared demand-grid computation (Phase 3 §4, Phase 5 §10/§12) — the
 * admin demand-map endpoint and the driver-facing generalized heat map
 * both read the same underlying data and apply the same admin-
 * configurable green/yellow/red thresholds; only how much detail each
 * caller exposes differs (see api/driver/router.ts's /me/demand-map,
 * which strips this down to status only).
 */

export interface DemandGridCell {
  row: number
  col: number
  centerLat: number
  centerLng: number
  onlineDrivers: number
  openRequests: number
  demandRatio: number
  cancellationRatePct: number
  status: "green" | "yellow" | "red"
  flags: { highDemand: boolean; lowSupply: boolean; highCancellation: boolean }
}

export interface DemandGridResult {
  cells: DemandGridCell[]
  gridSize: number
  range: string
  zoneId: string | null
  thresholds: { greenMaxRatio: number; yellowMaxRatio: number }
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null
}

/** Maps a "range" query param to a Prisma date filter (Phase 4 §9 / Phase 5 §11). */
export function rideTimeRangeFilter(range: string): { gte: Date; lt?: Date } {
  const now = new Date()
  switch (range) {
    case "last15min":
      return { gte: new Date(now.getTime() - 15 * 60_000) }
    case "today": {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      return { gte: start }
    }
    case "yesterday": {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
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

export async function computeDemandGrid(params: {
  cityId: string
  zoneId?: string | null
  range?: string
  gridSize?: number
}): Promise<DemandGridResult> {
  const zoneId = params.zoneId ?? null
  const gridSize = Math.min(10, Math.max(2, params.gridSize ?? 5))
  const range = params.range || "lastHour"
  const rideCreatedFilter = rideTimeRangeFilter(range)

  const [onlineDrivers, openRequests, recentRides, greenMaxRatio, yellowMaxRatio, cancellationThreshold] = await Promise.all([
    prisma.driverProfile.findMany({
      where: { cityId: params.cityId, availabilityStatus: "online", lastLat: { not: null }, lastLng: { not: null } },
      select: { lastLat: true, lastLng: true },
    }),
    prisma.rideRequest.findMany({
      where: { cityId: params.cityId, status: { in: ["searching", "offers_open"] }, ...(zoneId ? { zoneId } : {}) },
      include: { pickup: { select: { lat: true, lng: true } } },
    }),
    prisma.ride.findMany({
      where: { rideRequest: { cityId: params.cityId, ...(zoneId ? { zoneId } : {}) }, createdAt: rideCreatedFilter },
      select: { status: true, pickup: { select: { lat: true, lng: true } } },
    }),
    getSetting("supplyDemand.greenMaxRatio"),
    getSetting("supplyDemand.yellowMaxRatio"),
    getSetting("risk.cancellationRateThresholdPct"),
  ])

  const points = [
    ...onlineDrivers.map((d) => ({ lat: d.lastLat!, lng: d.lastLng! })),
    ...openRequests.map((r) => ({ lat: r.pickup.lat, lng: r.pickup.lng })),
    ...recentRides.map((r) => ({ lat: r.pickup.lat, lng: r.pickup.lng })),
  ]
  if (points.length === 0) {
    return { cells: [], gridSize, range, zoneId, thresholds: { greenMaxRatio, yellowMaxRatio }, bounds: null }
  }

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

  const result: DemandGridCell[] = [...cells.values()].map((c) => {
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

  return { cells: result, gridSize, range, zoneId, thresholds: { greenMaxRatio, yellowMaxRatio }, bounds: { minLat, maxLat, minLng, maxLng } }
}

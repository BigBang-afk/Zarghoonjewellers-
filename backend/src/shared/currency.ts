import { prisma } from "../utils/prisma.js"

/**
 * Resolves the currency a new Wallet (or any currency-less financial row)
 * for this user should use (Phase 4 §1/§3) — the user's own primary city
 * first, falling back to the first live city (the pilot city, in a
 * single-city launch), and only "USD" if the platform somehow has no
 * live city configured yet.
 */
export async function resolveUserCurrency(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { primaryCityId: true } })
  if (user?.primaryCityId) {
    const city = await prisma.city.findUnique({ where: { id: user.primaryCityId }, select: { currencyCode: true } })
    if (city) return city.currencyCode
  }
  return resolvePlatformDefaultCurrency()
}

/** The pilot (first live) city's currency — used before a user row even exists yet, e.g. at passenger registration. */
export async function resolvePlatformDefaultCurrency(): Promise<string> {
  const liveCity = await prisma.city.findFirst({ where: { status: "live" }, select: { currencyCode: true }, orderBy: { createdAt: "asc" } })
  return liveCity?.currencyCode ?? "USD"
}

import { prisma } from "../utils/prisma.js"
import { getSetting } from "../config/settings.js"
import { notify } from "./notifications/NotificationService.js"
import { emitToAdmin } from "../realtime/socket.js"

/**
 * Trust & Verification (Phase 3 §16-17). Workflow:
 *   pending -> under_review -> approved | rejected -> expired
 * A driver never shows as "verified" until an admin has actually
 * approved every submitted document (docs/09 §... never fake trust).
 */
export async function submitDriverDocument(input: {
  driverId: string
  docType: string
  fileUrl: string
  expiresAt?: Date | null
}) {
  const document = await prisma.driverDocument.create({
    data: { driverId: input.driverId, docType: input.docType, fileUrl: input.fileUrl, expiresAt: input.expiresAt, status: "pending" },
  })

  // First submission moves a brand-new driver from "pending" into the
  // admin's active review queue rather than sitting untouched.
  const driver = await prisma.driverProfile.findUnique({ where: { id: input.driverId } })
  if (driver && (driver.verificationStatus === "pending" || driver.verificationStatus === "expired")) {
    await prisma.driverProfile.update({ where: { id: input.driverId }, data: { verificationStatus: "under_review" } })
    emitToAdmin("driver.verification_submitted", { driverId: input.driverId })
  }

  return document
}

/**
 * Document-expiration sweep (Phase 3 §17) — run periodically:
 *   1. warn once when an approved document is within the configurable
 *      window of expiring (never re-warns the same document twice)
 *   2. flip a document + its driver back out of "approved" the moment
 *      it actually expires, so an expired license can never keep a
 *      driver marked verified
 */
export async function sweepDocumentExpirations(): Promise<void> {
  const warningDays = await getSetting("verification.documentExpiryWarningDays")
  const warningCutoff = new Date(Date.now() + warningDays * 86_400_000)
  const now = new Date()

  const [expiringDriverDocs, expiredDriverDocs, expiringVehicleDocs, expiredVehicleDocs] = await Promise.all([
    prisma.driverDocument.findMany({
      where: { status: "approved", expiresAt: { lte: warningCutoff, gt: now }, expiryWarnedAt: null },
      include: { driver: { include: { user: true } } },
    }),
    prisma.driverDocument.findMany({
      where: { status: "approved", expiresAt: { lte: now } },
      include: { driver: { include: { user: true } } },
    }),
    prisma.vehicleDocument.findMany({
      where: { status: "approved", expiresAt: { lte: warningCutoff, gt: now }, expiryWarnedAt: null },
      include: { vehicle: { include: { driver: { include: { user: true } } } } },
    }),
    prisma.vehicleDocument.findMany({
      where: { status: "approved", expiresAt: { lte: now } },
      include: { vehicle: { include: { driver: { include: { user: true } } } } },
    }),
  ])

  for (const doc of expiringDriverDocs) {
    await prisma.driverDocument.update({ where: { id: doc.id }, data: { expiryWarnedAt: new Date() } })
    await notify({
      userId: doc.driver.userId,
      type: "system",
      title: "Your document is expiring soon",
      body: `Your ${doc.docType.replace(/_/g, " ")} expires on ${doc.expiresAt!.toLocaleDateString()}. Please upload a renewed copy.`,
      data: { documentId: doc.id, docType: doc.docType, expiresAt: doc.expiresAt },
    })
    emitToAdmin("driver.document_expiring", { driverId: doc.driverId, docType: doc.docType, expiresAt: doc.expiresAt })
  }

  for (const doc of expiredDriverDocs) {
    await prisma.$transaction([
      prisma.driverDocument.update({ where: { id: doc.id }, data: { status: "expired" } }),
      prisma.driverProfile.update({ where: { id: doc.driverId }, data: { verificationStatus: "expired" } }),
    ])
    await notify({
      userId: doc.driver.userId,
      type: "system",
      title: "A document has expired",
      body: `Your ${doc.docType.replace(/_/g, " ")} has expired. You've been taken offline until it's renewed and re-verified.`,
      data: { documentId: doc.id, docType: doc.docType },
    })
    emitToAdmin("driver.verification_expired", { driverId: doc.driverId, docType: doc.docType })
  }

  for (const doc of expiringVehicleDocs) {
    await prisma.vehicleDocument.update({ where: { id: doc.id }, data: { expiryWarnedAt: new Date() } })
    await notify({
      userId: doc.vehicle.driver.userId,
      type: "system",
      title: "A vehicle document is expiring soon",
      body: `Your vehicle's ${doc.docType.replace(/_/g, " ")} expires on ${doc.expiresAt!.toLocaleDateString()}.`,
      data: { documentId: doc.id, vehicleId: doc.vehicleId, docType: doc.docType },
    })
  }

  for (const doc of expiredVehicleDocs) {
    await prisma.$transaction([
      prisma.vehicleDocument.update({ where: { id: doc.id }, data: { status: "expired" } }),
      prisma.vehicle.update({ where: { id: doc.vehicleId }, data: { status: "inactive" } }),
    ])
    await notify({
      userId: doc.vehicle.driver.userId,
      type: "system",
      title: "A vehicle document has expired",
      body: `Your vehicle's ${doc.docType.replace(/_/g, " ")} has expired and the vehicle has been deactivated until it's renewed.`,
      data: { documentId: doc.id, vehicleId: doc.vehicleId },
    })
    emitToAdmin("vehicle.document_expired", { vehicleId: doc.vehicleId, docType: doc.docType })
  }
}

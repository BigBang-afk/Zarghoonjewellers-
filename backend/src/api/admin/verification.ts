import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAdminRole } from "../../middleware/auth.js"
import { ApiError } from "../../utils/apiError.js"
import { writeAuditLog } from "../../shared/audit.js"
import { notify } from "../../services/notifications/NotificationService.js"
import { getSetting } from "../../config/settings.js"

export const adminVerificationRouter = Router()

adminVerificationRouter.get(
  "/drivers/verification-queue",
  asyncHandler(async (_req, res) => {
    const drivers = await prisma.driverProfile.findMany({
      where: { verificationStatus: "pending" },
      include: { user: true, vehicles: { include: { vehicleType: true, documents: true } }, documents: true, city: true },
      orderBy: { createdAt: "asc" },
    })
    res.json({ drivers })
  }),
)

adminVerificationRouter.post(
  "/drivers/:id/verify",
  requireAdminRole("super_admin", "ops_manager", "safety_officer"),
  validateBody(z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().trim().max(300).optional() })),
  asyncHandler(async (req, res) => {
    const driver = await prisma.driverProfile.findUnique({ where: { id: req.params.id }, include: { user: true, vehicles: true } })
    if (!driver) throw ApiError.notFound("Driver not found.")

    const newStatus = req.body.decision === "approve" ? "approved" : "rejected"
    const updated = await prisma.driverProfile.update({ where: { id: driver.id }, data: { verificationStatus: newStatus } })

    if (req.body.decision === "approve") {
      await prisma.vehicle.updateMany({ where: { driverId: driver.id, status: "pending" }, data: { status: "active" } })
    }

    await writeAuditLog({
      req,
      action: `driver.verify.${req.body.decision}`,
      targetTable: "driver_profiles",
      targetId: driver.id,
      before: { verificationStatus: driver.verificationStatus },
      after: { verificationStatus: newStatus, reason: req.body.reason },
    })

    await notify({
      userId: driver.userId,
      type: "system",
      title: req.body.decision === "approve" ? "You're verified!" : "Verification update",
      body:
        req.body.decision === "approve"
          ? "Your documents are approved. You can now go online and accept rides."
          : req.body.reason ?? "Your documents were not approved. Please review and resubmit.",
      external: true,
      toPhone: driver.user.phone,
    })

    res.json({ driverProfile: updated })
  }),
)

/** Documents nearing or past expiry (Phase 3 §17) — the same window the background sweep uses. */
adminVerificationRouter.get(
  "/drivers/document-expiry-queue",
  asyncHandler(async (_req, res) => {
    const warningDays = await getSetting("verification.documentExpiryWarningDays")
    const cutoff = new Date(Date.now() + warningDays * 86_400_000)
    const [driverDocs, vehicleDocs] = await Promise.all([
      prisma.driverDocument.findMany({
        where: { status: { in: ["approved", "expired"] }, expiresAt: { lte: cutoff } },
        include: { driver: { include: { user: true } } },
        orderBy: { expiresAt: "asc" },
      }),
      prisma.vehicleDocument.findMany({
        where: { status: { in: ["approved", "expired"] }, expiresAt: { lte: cutoff } },
        include: { vehicle: { include: { driver: { include: { user: true } } } } },
        orderBy: { expiresAt: "asc" },
      }),
    ])
    res.json({
      driverDocuments: driverDocs.map((d) => ({ id: d.id, driverId: d.driverId, driverName: d.driver.user.fullName, docType: d.docType, status: d.status, expiresAt: d.expiresAt })),
      vehicleDocuments: vehicleDocs.map((d) => ({ id: d.id, vehicleId: d.vehicleId, driverName: d.vehicle.driver.user.fullName, docType: d.docType, status: d.status, expiresAt: d.expiresAt })),
    })
  }),
)

adminVerificationRouter.post(
  "/driver-documents/:id/review",
  requireAdminRole("super_admin", "ops_manager", "safety_officer"),
  validateBody(z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().trim().max(300).optional() })),
  asyncHandler(async (req, res) => {
    const doc = await prisma.driverDocument.findUnique({ where: { id: req.params.id } })
    if (!doc) throw ApiError.notFound("Document not found.")
    const status = req.body.decision === "approve" ? "approved" : "rejected"
    const updated = await prisma.driverDocument.update({
      where: { id: doc.id },
      data: { status, reviewedById: req.auth!.userId, reviewedAt: new Date(), rejectionReason: req.body.decision === "reject" ? req.body.reason : null },
    })
    await writeAuditLog({ req, action: `driver_document.review.${req.body.decision}`, targetTable: "driver_documents", targetId: doc.id })
    res.json({ document: updated })
  }),
)

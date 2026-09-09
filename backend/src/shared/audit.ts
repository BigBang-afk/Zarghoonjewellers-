import type { Request } from "express"
import { prisma } from "../utils/prisma.js"

/** Every privileged admin action writes an immutable AuditLog row (docs/06 §7). */
export async function writeAuditLog(params: {
  req: Request
  action: string
  targetTable: string
  targetId?: string
  before?: unknown
  after?: unknown
}) {
  const admin = await prisma.adminUser.findUnique({ where: { userId: params.req.auth!.userId } })
  if (!admin) return // shouldn't happen behind requireRole("admin"), but never throw from audit logging
  await prisma.auditLog.create({
    data: {
      adminId: admin.id,
      action: params.action,
      targetTable: params.targetTable,
      targetId: params.targetId,
      beforeState: params.before ? JSON.stringify(params.before) : null,
      afterState: params.after ? JSON.stringify(params.after) : null,
      ipAddress: params.req.ip,
    },
  })
}

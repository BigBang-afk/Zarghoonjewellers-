import { Router } from "express"
import { z } from "zod"
import jwt from "jsonwebtoken"
import { prisma } from "../../utils/prisma.js"
import { hashPassword, verifyPassword } from "../../utils/password.js"
import { issueRefreshToken, revokeRefreshToken, rotateRefreshToken, signAccessToken } from "../../utils/jwt.js"
import { requestOtp, verifyOtp } from "../../services/otp/OtpService.js"
import { createReferralCodeForUser, applyReferralCode } from "../../services/referralService.js"
import { resolvePlatformDefaultCurrency } from "../../shared/currency.js"
import { ApiError } from "../../utils/apiError.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAuth } from "../../middleware/auth.js"
import { authRateLimit } from "../../middleware/rateLimit.js"
import { env } from "../../config/env.js"
import type { UserRole } from "../../types/enums.js"

export const authRouter = Router()
authRouter.use(authRateLimit)

// ---------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------

const phoneSchema = z.string().trim().regex(/^\+?[0-9]{7,15}$/, "Enter a valid phone number")

const registerPassengerSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  phone: phoneSchema,
  email: z.string().trim().email().optional(),
  password: z.string().min(8).max(72),
  photoUrl: z.string().url().optional(),
  referredByCode: z.string().trim().max(20).optional(),
})

const registerDriverSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  phone: phoneSchema,
  email: z.string().trim().email(),
  password: z.string().min(8).max(72),
  photoUrl: z.string().url().optional(),
  cityId: z.string().uuid(),
  vehicle: z.object({
    vehicleTypeCode: z.enum(["bike", "rickshaw", "economy", "standard", "premium"]),
    make: z.string().trim().min(1).max(40),
    model: z.string().trim().min(1).max(40),
    year: z.number().int().min(1990).max(new Date().getFullYear() + 1).optional(),
    color: z.string().trim().max(30).optional(),
    plateNumber: z.string().trim().min(3).max(20),
  }),
  referredByCode: z.string().trim().max(20).optional(),
})

const loginSchema = z.object({ phone: phoneSchema, password: z.string().min(1) })
const otpRequestSchema = z.object({
  phone: phoneSchema,
  purpose: z.enum(["registration", "login", "reset_password"]),
})
const otpVerifySchema = z.object({ requestId: z.string().uuid(), code: z.string().length(6) })
const refreshSchema = z.object({ refreshToken: z.string().min(10) })
const resetPasswordSchema = z.object({ resetToken: z.string().min(10), newPassword: z.string().min(8).max(72) })

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

async function issueSession(userId: string, role: UserRole) {
  let adminRole: string | undefined
  let cityScope: string | null | undefined
  if (role === "admin") {
    const admin = await prisma.adminUser.findUnique({ where: { userId } })
    adminRole = admin?.role
    cityScope = admin?.cityScope
  }
  const accessToken = signAccessToken({ sub: userId, role, adminRole: adminRole as never, cityScope })
  const refreshToken = await issueRefreshToken(userId)
  return { accessToken, refreshToken }
}

function publicUser(user: { id: string; fullName: string; phone: string; email: string | null; role: string; status: string; photoUrl: string | null }) {
  return { id: user.id, fullName: user.fullName, phone: user.phone, email: user.email, role: user.role, status: user.status, photoUrl: user.photoUrl }
}

// ---------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------

authRouter.post(
  "/register/passenger",
  validateBody(registerPassengerSchema),
  asyncHandler(async (req, res) => {
    const { fullName, phone, email, password, photoUrl, referredByCode } = req.body

    const existing = await prisma.user.findUnique({ where: { phone } })
    if (existing) throw ApiError.conflict("PHONE_ALREADY_REGISTERED", "An account with this phone number already exists.")

    const passwordHash = await hashPassword(password)
    const currencyCode = await resolvePlatformDefaultCurrency()
    const user = await prisma.user.create({
      data: {
        fullName,
        phone,
        email,
        passwordHash,
        photoUrl,
        role: "passenger",
        status: "pending_verification",
        passengerProfile: { create: {} },
        wallet: { create: { balance: 0, currencyCode } },
      },
    })

    await createReferralCodeForUser(user.id, fullName)
    let referralApplied = false
    if (referredByCode) {
      try {
        await applyReferralCode(user.id, referredByCode)
        referralApplied = true
      } catch {
        // Invalid/self-referral codes never block registration — the
        // passenger just doesn't get credited with a referrer.
      }
    }

    const otp = await requestOtp(phone, "registration", user.id)
    res.status(201).json({ userId: user.id, referralApplied, otp: { requestId: otp.requestId, expiresAt: otp.expiresAt, devCode: otp.devCode } })
  }),
)

authRouter.post(
  "/register/driver",
  validateBody(registerDriverSchema),
  asyncHandler(async (req, res) => {
    const { fullName, phone, email, password, photoUrl, cityId, vehicle, referredByCode } = req.body

    const existing = await prisma.user.findUnique({ where: { phone } })
    if (existing) throw ApiError.conflict("PHONE_ALREADY_REGISTERED", "An account with this phone number already exists.")

    const city = await prisma.city.findUnique({ where: { id: cityId } })
    if (!city) throw ApiError.badRequest("INVALID_CITY", "Selected city was not found.")

    const vehicleType = await prisma.vehicleType.findUnique({ where: { code: vehicle.vehicleTypeCode } })
    if (!vehicleType) throw ApiError.badRequest("INVALID_VEHICLE_TYPE", "Selected vehicle type was not found.")

    const existingPlate = await prisma.vehicle.findUnique({ where: { plateNumber: vehicle.plateNumber } })
    if (existingPlate) throw ApiError.conflict("PLATE_ALREADY_REGISTERED", "This vehicle plate is already registered.")

    const passwordHash = await hashPassword(password)
    const user = await prisma.user.create({
      data: {
        fullName,
        phone,
        email,
        passwordHash,
        photoUrl,
        role: "driver",
        status: "pending_verification",
        primaryCityId: cityId,
        wallet: { create: { balance: 0, currencyCode: city.currencyCode } },
        driverProfile: {
          create: {
            cityId,
            verificationStatus: "pending",
            availabilityStatus: "offline",
            vehicles: {
              create: {
                vehicleTypeId: vehicleType.id,
                make: vehicle.make,
                model: vehicle.model,
                year: vehicle.year,
                color: vehicle.color,
                plateNumber: vehicle.plateNumber,
                status: "pending",
              },
            },
          },
        },
      },
    })

    await createReferralCodeForUser(user.id, fullName)
    let referralApplied = false
    if (referredByCode) {
      try {
        await applyReferralCode(user.id, referredByCode)
        referralApplied = true
      } catch {
        // Invalid/self-referral codes never block registration.
      }
    }

    const otp = await requestOtp(phone, "registration", user.id)
    res.status(201).json({
      userId: user.id,
      referralApplied,
      otp: { requestId: otp.requestId, expiresAt: otp.expiresAt, devCode: otp.devCode },
      note: "Your account and vehicle now await admin document verification before you can go online.",
    })
  }),
)

// ---------------------------------------------------------------------
// OTP
// ---------------------------------------------------------------------

authRouter.post(
  "/otp/request",
  validateBody(otpRequestSchema),
  asyncHandler(async (req, res) => {
    const { phone, purpose } = req.body
    if (purpose !== "registration") {
      const user = await prisma.user.findUnique({ where: { phone } })
      if (!user) throw ApiError.notFound("No account found for this phone number.")
      const otp = await requestOtp(phone, purpose, user.id)
      res.json({ requestId: otp.requestId, expiresAt: otp.expiresAt, devCode: otp.devCode })
      return
    }
    const otp = await requestOtp(phone, purpose)
    res.json({ requestId: otp.requestId, expiresAt: otp.expiresAt, devCode: otp.devCode })
  }),
)

authRouter.post(
  "/otp/verify",
  validateBody(otpVerifySchema),
  asyncHandler(async (req, res) => {
    const { requestId, code } = req.body
    const result = await verifyOtp(requestId, code)

    if (result.purpose === "reset_password") {
      if (!result.userId) throw ApiError.badRequest("OTP_NOT_LINKED", "This code is not linked to an account.")
      const resetToken = jwt.sign({ sub: result.userId, scope: "password_reset" }, env.jwtAccessSecret, { expiresIn: "15m" })
      res.json({ purpose: "reset_password", resetToken })
      return
    }

    if (!result.userId) throw ApiError.badRequest("OTP_NOT_LINKED", "This code is not linked to an account.")
    const user = await prisma.user.update({
      where: { id: result.userId },
      data: { phoneVerifiedAt: new Date(), status: "active" },
    })
    const session = await issueSession(user.id, user.role as UserRole)
    res.json({ purpose: result.purpose, user: publicUser(user), ...session })
  }),
)

// ---------------------------------------------------------------------
// Password login / reset
// ---------------------------------------------------------------------

authRouter.post(
  "/login",
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { phone, password } = req.body
    const user = await prisma.user.findUnique({ where: { phone } })
    if (!user || !user.passwordHash) throw ApiError.badRequest("INVALID_CREDENTIALS", "Incorrect phone number or password.")
    if (user.status === "banned" || user.status === "suspended") {
      throw ApiError.forbidden("This account is no longer active. Contact support.")
    }
    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) throw ApiError.badRequest("INVALID_CREDENTIALS", "Incorrect phone number or password.")

    const session = await issueSession(user.id, user.role as UserRole)
    res.json({ user: publicUser(user), ...session })
  }),
)

authRouter.post(
  "/forgot-password",
  validateBody(z.object({ phone: phoneSchema })),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { phone: req.body.phone } })
    if (!user) {
      // Do not reveal account existence.
      res.json({ ok: true })
      return
    }
    const otp = await requestOtp(user.phone, "reset_password", user.id)
    res.json({ ok: true, otp: { requestId: otp.requestId, expiresAt: otp.expiresAt, devCode: otp.devCode } })
  }),
)

authRouter.post(
  "/reset-password",
  validateBody(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    const { resetToken, newPassword } = req.body
    let claims: { sub: string; scope: string }
    try {
      claims = jwt.verify(resetToken, env.jwtAccessSecret) as { sub: string; scope: string }
    } catch {
      throw ApiError.badRequest("INVALID_RESET_TOKEN", "This reset link has expired or is invalid.")
    }
    if (claims.scope !== "password_reset") throw ApiError.badRequest("INVALID_RESET_TOKEN", "Invalid reset token.")

    const passwordHash = await hashPassword(newPassword)
    await prisma.user.update({ where: { id: claims.sub }, data: { passwordHash } })
    res.json({ ok: true })
  }),
)

// ---------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------

authRouter.post(
  "/token/refresh",
  validateBody(refreshSchema),
  asyncHandler(async (req, res) => {
    try {
      const { userId, newToken } = await rotateRefreshToken(req.body.refreshToken)
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
      const accessToken = signAccessToken({ sub: user.id, role: user.role as UserRole })
      res.json({ accessToken, refreshToken: newToken })
    } catch {
      throw ApiError.unauthorized("Session expired. Please log in again.")
    }
  }),
)

authRouter.post(
  "/logout",
  validateBody(refreshSchema),
  asyncHandler(async (req, res) => {
    await revokeRefreshToken(req.body.refreshToken)
    res.status(204).send()
  }),
)

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.auth!.userId },
      include: { passengerProfile: true, driverProfile: { include: { vehicles: true } }, adminProfile: true, wallet: true },
    })
    res.json({ user: publicUser(user), passengerProfile: user.passengerProfile, driverProfile: user.driverProfile, adminProfile: user.adminProfile, wallet: user.wallet })
  }),
)

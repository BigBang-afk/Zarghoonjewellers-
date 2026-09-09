import { prisma } from "../../utils/prisma.js"
import { env } from "../../config/env.js"
import { consoleSmsProvider } from "../notifications/ConsoleProviders.js"
import { ApiError } from "../../utils/apiError.js"

const OTP_TTL_MINUTES = 5
const OTP_LENGTH = 6

function generateCode(): string {
  // MOCK_OTP dev shortcut: a fixed, easy-to-type code so manual testing
  // and the seed/demo accounts don't require reading server logs. Real
  // random codes are still used once MOCK_OTP=false.
  if (env.mockOtp) return "123456"
  return Math.floor(Math.random() * 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, "0")
}

export type OtpPurpose = "registration" | "login" | "reset_password"

/**
 * Mock-by-default OTP provider. Real SMS delivery requires
 * SMS_PROVIDER_* credentials (.env.example) and MOCK_OTP=false — until
 * then this generates and stores a real, single-use, expiring code (the
 * verification logic is genuine) but "sends" it via the console SMS
 * provider and, only in non-production, echoes it back in the API
 * response so the flow is testable without a real phone.
 */
export async function requestOtp(phone: string, purpose: OtpPurpose, userId?: string) {
  const code = generateCode()
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000)

  const otp = await prisma.otpCode.create({
    data: { phone, code, purpose, userId, expiresAt },
  })

  await consoleSmsProvider.send({
    to: phone,
    title: "RIVO verification code",
    body: `Your RIVO code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`,
  })

  return {
    requestId: otp.id,
    expiresAt,
    // Only present outside production so the mock flow is directly usable
    // from the frontend/tests without reading server logs.
    devCode: env.isProduction ? undefined : code,
  }
}

export async function verifyOtp(requestId: string, code: string): Promise<{ phone: string; purpose: OtpPurpose; userId: string | null }> {
  const otp = await prisma.otpCode.findUnique({ where: { id: requestId } })
  if (!otp) throw ApiError.badRequest("OTP_NOT_FOUND", "This verification request was not found.")
  if (otp.consumedAt) throw ApiError.badRequest("OTP_ALREADY_USED", "This code has already been used.")
  if (otp.expiresAt < new Date()) throw ApiError.badRequest("OTP_EXPIRED", "This code has expired. Request a new one.")
  if (otp.code !== code) throw ApiError.badRequest("OTP_INVALID", "Incorrect verification code.")

  await prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } })

  return { phone: otp.phone, purpose: otp.purpose as OtpPurpose, userId: otp.userId }
}

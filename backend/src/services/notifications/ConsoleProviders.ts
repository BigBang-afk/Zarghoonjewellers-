import { env } from "../../config/env.js"
import type { EmailProvider, OutboundMessage, PushProvider, SmsProvider } from "./NotificationProvider.js"

/**
 * Dev/mock channel providers — log to the server console instead of
 * calling a real SMS/push/email gateway. Wired in whenever
 * MOCK_NOTIFICATIONS=true (the default). Swap for a Twilio/FCM/SendGrid
 * adapter (implementing the same interfaces) once those credentials
 * exist — see .env.example.
 */
class ConsoleChannel implements SmsProvider, PushProvider, EmailProvider {
  constructor(private readonly channel: string) {}

  async send(message: OutboundMessage): Promise<{ delivered: boolean; providerReference?: string }> {
    if (!env.isProduction) {
      // eslint-disable-next-line no-console
      console.log(`[mock:${this.channel}] -> ${message.to}: ${message.title} — ${message.body}`)
    }
    return { delivered: true, providerReference: `mock_${this.channel}_${Date.now()}` }
  }
}

export const consoleSmsProvider: SmsProvider = new ConsoleChannel("sms")
export const consolePushProvider: PushProvider = new ConsoleChannel("push")
export const consoleEmailProvider: EmailProvider = new ConsoleChannel("email")

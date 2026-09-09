export interface OutboundMessage {
  to: string // phone, email, or device token depending on channel
  title: string
  body: string
}

/**
 * One interface per external channel. The in-app Notification row +
 * real-time socket push (see NotificationService) are always real; these
 * external channels are where production credentials are required.
 */
export interface SmsProvider {
  send(message: OutboundMessage): Promise<{ delivered: boolean; providerReference?: string }>
}
export interface PushProvider {
  send(message: OutboundMessage): Promise<{ delivered: boolean; providerReference?: string }>
}
export interface EmailProvider {
  send(message: OutboundMessage): Promise<{ delivered: boolean; providerReference?: string }>
}

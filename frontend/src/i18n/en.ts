/**
 * English dictionary (default/fallback). Every key here MUST also exist
 * in every other locale dictionary — the i18n index enforces this at
 * dev-time via the shared Dictionary type.
 */
export const en = {
  // Common
  "common.confirm": "Confirm",
  "common.cancel": "Cancel",
  "common.retry": "Retry",
  "common.submit": "Submit",
  "common.save": "Save",
  "common.close": "Close",
  "common.back": "Back",
  "common.loading": "Loading…",
  "common.apply": "Apply",
  "common.skip": "Skip for now",

  // Navigation
  "nav.home": "Home",
  "nav.activity": "Activity",
  "nav.wallet": "Wallet",
  "nav.profile": "Profile",
  "nav.dashboard": "Dashboard",

  // Auth
  "auth.login": "Log in",
  "auth.phone": "Phone number",
  "auth.password": "Password",
  "auth.loginButton": "Log in",
  "auth.noAccount": "Don't have an account?",
  "auth.registerPassenger": "Sign up as a passenger",
  "auth.registerDriver": "Sign up as a driver",
  "auth.language": "Language",

  // Ride states
  "ride.searching": "Finding nearby drivers…",
  "ride.offersReceived": "{{count}} drivers are available.",
  "ride.driverSelected": "{{driverName}} is arriving in {{etaMin}} minutes.",
  "ride.driverArriving": "Your driver is on the way.",
  "ride.driverArrived": "Your driver has arrived.",
  "ride.started": "You're on your way.",
  "ride.completed": "Ride completed.",
  "ride.cancelled": "Ride cancelled.",

  // Errors
  "error.generic": "Something went wrong. Please try again.",
  "error.network": "Network error. Check your connection and try again.",
  "error.validation": "Please check the highlighted fields.",

  // Payment / wallet
  "payment.cash": "Cash",
  "payment.card": "Card",
  "payment.wallet": "Wallet",
  "wallet.balance": "Balance",
  "wallet.topup": "Top up",

  // Support
  "support.title": "Support",
  "support.openTicket": "Open a ticket",

  // Quick destinations
  "quickDest.home": "Home",
  "quickDest.work": "Work",
  "quickDest.airport": "Airport",
} as const

export type TranslationKey = keyof typeof en
export type Dictionary = Record<TranslationKey, string>

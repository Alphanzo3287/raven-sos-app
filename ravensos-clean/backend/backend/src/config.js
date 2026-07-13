// Central config. Everything has a safe default so the server runs with zero
// setup. Real providers activate only when their env vars are present.

export const config = {
  port: Number(process.env.PORT ?? 4000),

  // Escalation: if no tier-1 guardian acknowledges within this window,
  // escalate to tier-2 and hand off to the monitoring-center/RapidSOS path.
  escalationMs: Number(process.env.ESCALATION_MS ?? 60_000),

  // Countdown before a COUNTDOWN-type alert auto-fires (cancelable with safe PIN).
  countdownMs: Number(process.env.COUNTDOWN_MS ?? 10_000),

  // Twilio (SMS). If unset, SMS notifier logs instead of sending.
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? null,
    authToken: process.env.TWILIO_AUTH_TOKEN ?? null,
    fromNumber: process.env.TWILIO_FROM ?? null,
  },

  // Firebase (push). If unset, push notifier logs instead of sending.
  fcm: {
    serviceAccountJson: process.env.FCM_SERVICE_ACCOUNT_JSON ?? null,
  },

  // RapidSOS (911 bridge). Partnership-gated; adapter is a documented stub.
  rapidsos: {
    apiKey: process.env.RAPIDSOS_API_KEY ?? null,
    baseUrl: process.env.RAPIDSOS_BASE_URL ?? 'https://api.rapidsos.com',
  },

  // Web Push (free in-app notifications). Keys set via env vars.
  vapid: {
    publicKey: process.env.VAPID_PUBLIC ?? null,
    privateKey: process.env.VAPID_PRIVATE ?? null,
    subject: process.env.VAPID_SUBJECT ?? 'mailto:alerts@ravensos.app',
  },

  // Supabase (durable state snapshot). If unset, falls back to local JSON file.
  supabase: {
    url: process.env.SUPABASE_URL ?? null,
    serviceKey: process.env.SUPABASE_SERVICE_KEY ?? null,
  },

  mapLinks: {
    google: (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    waze: (lat, lng) => `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`,
    apple: (lat, lng) => `https://maps.apple.com/?ll=${lat},${lng}`,
  },
};

export const isTwilioConfigured = () =>
  !!(config.twilio.accountSid && config.twilio.authToken && config.twilio.fromNumber);

export const isFcmConfigured = () => !!config.fcm.serviceAccountJson;

export const isRapidSosConfigured = () => !!config.rapidsos.apiKey;

export const isSupabaseConfigured = () =>
  !!(config.supabase.url && config.supabase.serviceKey);

export const isVapidConfigured = () =>
  !!(config.vapid.publicKey && config.vapid.privateKey);

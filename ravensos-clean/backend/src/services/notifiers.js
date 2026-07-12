import { config, isTwilioConfigured, isFcmConfigured } from '../config.js';

// A notifier sends one message over one channel and returns { providerRef }.
// Real providers activate only when configured; otherwise they log, so the whole
// pipeline is exercisable end-to-end with zero external accounts.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wrap any async send fn with exponential backoff + jitter.
 * Emergency sends must be resilient to transient provider failures.
 */
export async function withRetry(fn, { retries = 3, baseMs = 200 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const backoff = baseMs * 2 ** attempt + Math.random() * baseMs;
      await sleep(backoff);
    }
  }
  throw lastErr;
}

// ---- SMS (Twilio) ----
let twilioClient = null;
async function getTwilio() {
  if (twilioClient) return twilioClient;
  const { default: twilio } = await import('twilio');
  twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
  return twilioClient;
}

export async function sendSms({ to, body }) {
  if (!isTwilioConfigured()) {
    console.log(`[SMS:mock] -> ${to}\n         ${body.replace(/\n/g, '\n         ')}`);
    return { providerRef: `mock-sms-${Date.now()}`, mocked: true };
  }
  const client = await getTwilio();
  const msg = await client.messages.create({ to, from: config.twilio.fromNumber, body });
  return { providerRef: msg.sid, mocked: false };
}

// ---- Push (FCM) ----
let fcmApp = null;
async function getFcm() {
  if (fcmApp) return fcmApp;
  const admin = await import('firebase-admin');
  fcmApp = admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(config.fcm.serviceAccountJson)),
  });
  return admin;
}

export async function sendPush({ token, title, body, data }) {
  if (!isFcmConfigured() || !token) {
    console.log(`[PUSH:mock] -> ${token ?? 'device'}  "${title}"  ${JSON.stringify(data)}`);
    return { providerRef: `mock-push-${Date.now()}`, mocked: true };
  }
  const admin = await getFcm();
  const id = await admin.messaging().send({
    token,
    notification: { title, body },
    data,
    android: { priority: 'high' },
    apns: { headers: { 'apns-priority': '10', 'apns-push-type': 'alert' } },
  });
  return { providerRef: id, mocked: false };
}

// Build the human-facing alert copy once, reused across channels.
export function buildAlertMessage({ userName, address, lat, lng }) {
  const map = config.mapLinks.google(lat, lng);
  const title = `${userName} triggered an emergency alert`;
  const body = `${userName} needs help near ${address ?? 'an unknown location'}. Tap to see live location.`;
  const sms = `EMERGENCY: ${userName} triggered a Guardian alert near ${address ?? 'unknown location'}.\nLive map: ${map}`;
  return { title, body, sms, map };
}

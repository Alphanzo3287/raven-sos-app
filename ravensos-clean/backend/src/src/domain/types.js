// Domain enums / constants. Kept as plain frozen objects so the code runs as-is;
// migrate to TypeScript union types trivially later.

export const AlertStatus = Object.freeze({
  ARMED: 'armed',
  COUNTDOWN: 'countdown',
  TRIGGERED: 'triggered',
  ACTIVE: 'active',
  VERIFYING: 'verifying',
  DISPATCHED_911: 'dispatched_911',
  RESOLVED: 'resolved',
});

export const TriggerType = Object.freeze({
  MANUAL: 'manual',
  COUNTDOWN: 'countdown',
  DURESS: 'duress',
  HARDWARE: 'hardware',
  VOICE: 'voice',
  FOB: 'fob',
  FAKE_SHUTDOWN: 'fake_shutdown',
});

export const Channel = Object.freeze({
  PUSH: 'push',
  SMS: 'sms',
  VOICE: 'voice',
});

export const ChannelPref = Object.freeze({
  PUSH: 'push',
  SMS: 'sms',
  BOTH: 'both',
});

export const NotificationStatus = Object.freeze({
  QUEUED: 'queued',
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  ACKNOWLEDGED: 'acknowledged',
});

export const Resolution = Object.freeze({
  SAFE: 'safe',
  FALSE_ALARM: 'false_alarm',
  RESPONDED: 'responded',
  UNKNOWN: 'unknown',
});

/**
 * @typedef {Object} Alert
 * @property {string} id
 * @property {string} ownerId
 * @property {string} status
 * @property {string} triggerType
 * @property {string} triggeredAt
 * @property {number} originLat
 * @property {number} originLng
 * @property {number} originAccuracyM
 * @property {string} originAddress
 * @property {boolean} isSilent
 * @property {string} verifiedBy
 * @property {boolean} dispatched911
 * @property {?string} resolvedAt
 * @property {?string} resolution
 */

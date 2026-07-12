import { config } from '../config.js';
import { Channel, ChannelPref, NotificationStatus } from '../domain/types.js';
import { sendSms, sendPush, buildAlertMessage, withRetry } from './notifiers.js';

// Fan-out is the heart of the system. When an alert fires we:
//  1. resolve the tier-1 recipient set,
//  2. dispatch push AND sms in parallel (never gate sms on push — push is lossy),
//  3. record every attempt in the notification ledger,
//  4. arm an escalation timer that pulls in tier-2 + the monitoring/RapidSOS path
//     if nobody acknowledges in time.

const escalationTimers = new Map(); // alertId -> timeout handle

function channelsFor(pref) {
  if (pref === ChannelPref.PUSH) return [Channel.PUSH];
  if (pref === ChannelPref.SMS) return [Channel.SMS];
  return [Channel.PUSH, Channel.SMS];
}

async function dispatchOne(store, alert, guardian, channel, message) {
  const notif = store.createNotification({
    alertId: alert.id,
    recipientId: guardian.id,
    channel,
    status: NotificationStatus.QUEUED,
  });
  try {
    const result = await withRetry(() => {
      if (channel === Channel.SMS) return sendSms({ to: guardian.phone, body: message.sms });
      return sendPush({
        token: guardian.pushToken ?? null,
        title: message.title,
        body: message.body,
        data: { alertId: alert.id, map: message.map, type: 'guardian_alert' },
      });
    });
    store.updateNotification(notif.id, {
      status: NotificationStatus.SENT,
      providerRef: result.providerRef,
      sentAt: new Date().toISOString(),
    });
    return { channel, guardian: guardian.name, ok: true, mocked: result.mocked };
  } catch (err) {
    store.updateNotification(notif.id, { status: NotificationStatus.FAILED });
    return { channel, guardian: guardian.name, ok: false, error: String(err?.message ?? err) };
  }
}

/**
 * Fan an alert out to a set of guardians across their preferred channels, all in
 * parallel. Returns the per-attempt results.
 */
export async function fanOut(store, alert, guardians, message) {
  const jobs = [];
  for (const g of guardians) {
    for (const channel of channelsFor(g.channelPref)) {
      jobs.push(dispatchOne(store, alert, g, channel, message));
    }
  }
  const settled = await Promise.allSettled(jobs);
  return settled.map((s) => (s.status === 'fulfilled' ? s.value : { ok: false, error: String(s.reason) }));
}

/**
 * Arm escalation. If no tier-1 guardian acknowledges before escalationMs, notify
 * tier-2 and hand the incident to the monitoring center / RapidSOS bridge.
 */
export function armEscalation(store, alert, message, { onEscalate } = {}) {
  const handle = setTimeout(async () => {
    const acked = store
      .listNotifications(alert.id)
      .some((n) => n.status === NotificationStatus.ACKNOWLEDGED);
    if (acked) return;

    const tier2 = store.listGuardians(alert.ownerId, { tier: 2 });
    let results = [];
    if (tier2.length) results = await fanOut(store, alert, tier2, message);

    // Monitoring-center / RapidSOS handoff (real integration is partnership-gated).
    console.log(`[ESCALATION] alert ${alert.id} unacknowledged after ${config.escalationMs}ms -> tier-2 + monitoring center handoff`);
    store.updateAlert(alert.id, { status: 'verifying' });
    onEscalate?.({ alert, tier2Results: results });
  }, config.escalationMs);

  escalationTimers.set(alert.id, handle);
}

export function cancelEscalation(alertId) {
  const h = escalationTimers.get(alertId);
  if (h) { clearTimeout(h); escalationTimers.delete(alertId); }
}

export { buildAlertMessage };

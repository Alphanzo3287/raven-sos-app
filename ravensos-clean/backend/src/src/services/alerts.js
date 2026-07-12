import { v4 as uuid } from 'uuid';
import { AlertStatus, NotificationStatus, TriggerType, Resolution } from '../domain/types.js';
import { fanOut, armEscalation, cancelEscalation, buildAlertMessage } from './fanout.js';
import { isRapidSosConfigured } from '../config.js';

// Orchestrates an alert's whole life: trigger -> fan-out -> live -> resolve.
// Depends on `store` and the realtime `hub` (injected so it's testable).

export function createAlertService(store, hub) {
  async function trigger({ ownerId, lat, lng, accuracyM = null, address = null, triggerType = TriggerType.MANUAL, isSilent = false, idempotencyKey = null, origin = null }) {
    // Idempotency: a retried trigger must not create a second alert.
    if (idempotencyKey) {
      const existing = store.getAlertByIdempotencyKey(idempotencyKey);
      if (existing) return { alert: existing, results: [], deduped: true };
    }

    const owner = store.getUser(ownerId);
    if (!owner) throw new Error('unknown owner');

    const alert = store.createAlert({
      ownerId,
      status: AlertStatus.ACTIVE,
      triggerType,
      triggeredAt: new Date().toISOString(),
      originLat: lat,
      originLng: lng,
      originAccuracyM: accuracyM,
      originAddress: address,
      isSilent,
      verifiedBy: 'none',
      dispatched911: false,
      resolvedAt: null,
      resolution: null,
    }, idempotencyKey);

    // Short share token so guardians can open a live-watch link without an account.
    const watchToken = uuid().slice(0, 8);
    store.setWatchToken(watchToken, alert.id);
    store.updateAlert(alert.id, { watchToken });

    const watchLink = origin ? `${origin.replace(/\/$/, '')}/?watch=${watchToken}` : null;
    const message = buildAlertMessage({ userName: owner.displayName, address, lat, lng, watchLink });
    const tier1 = store.listGuardians(ownerId, { tier: 1 });
    const results = await fanOut(store, alert, tier1, message);

    armEscalation(store, alert, message, {
      onEscalate: ({ alert: a }) => hub?.broadcastStatus(a.id, store.getAlert(a.id)),
    });

    hub?.broadcastStatus(alert.id, alert);
    return { alert: store.getAlert(alert.id), results, deduped: false, notifiedTier1: tier1.length, watchToken };
  }

  function acknowledge({ alertId, guardianId }) {
    const notifs = store.listNotifications(alertId).filter((n) => n.recipientId === guardianId);
    for (const n of notifs) {
      store.updateNotification(n.id, {
        status: NotificationStatus.ACKNOWLEDGED,
        acknowledgedAt: new Date().toISOString(),
      });
    }
    // First ack cancels escalation — a human is now engaged.
    cancelEscalation(alertId);
    const alert = store.getAlert(alertId);
    hub?.broadcastStatus(alertId, alert);
    return alert;
  }

  function addPing({ alertId, lat, lng, accuracyM = null, speedMps = null, headingDeg = null, recordedAt = null }) {
    const ping = store.addPing(alertId, {
      lat, lng, accuracyM, speedMps, headingDeg,
      recordedAt: recordedAt ?? new Date().toISOString(),
    });
    hub?.broadcastPing(alertId, ping);
    return ping;
  }

  function addMedia({ alertId, kind, seq, s3Key, durationMs = null, sha256 = null, startedAt = null }) {
    return store.addMedia(alertId, { kind, seq, s3Key, durationMs, sha256, startedAt: startedAt ?? new Date().toISOString() });
  }

  // Monitoring agent verified a real emergency -> push to 911 via RapidSOS.
  // Real call is partnership-gated; this is the documented integration point.
  async function dispatch911({ alertId }) {
    const alert = store.getAlert(alertId);
    if (!alert) throw new Error('unknown alert');
    let incidentId;
    if (isRapidSosConfigured()) {
      // POST to RapidSOS Emergency API with owner identity + live location +
      // medical profile; returns an incident id. Left as an integration stub.
      incidentId = `rapidsos-${alertId}`; // placeholder for the real API response
    } else {
      incidentId = `mock-911-${alertId}`;
      console.log(`[911:mock] would dispatch alert ${alertId} to nearest ECC via RapidSOS`);
    }
    store.updateAlert(alertId, {
      status: AlertStatus.DISPATCHED_911,
      dispatched911: true,
      verifiedBy: 'agent',
      rapidsosIncidentId: incidentId,
    });
    const updated = store.getAlert(alertId);
    hub?.broadcastStatus(alertId, updated);
    return updated;
  }

  function resolve({ alertId, resolution = Resolution.SAFE }) {
    cancelEscalation(alertId);
    store.updateAlert(alertId, {
      status: AlertStatus.RESOLVED,
      resolvedAt: new Date().toISOString(),
      resolution,
    });
    const alert = store.getAlert(alertId);
    hub?.broadcastStatus(alertId, alert);
    return alert;
  }

  return { trigger, acknowledge, addPing, addMedia, dispatch911, resolve };
}

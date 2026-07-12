import { v4 as uuid } from 'uuid';

// In-memory implementation of the data layer so the service runs with zero
// external dependencies. Every method mirrors what a Postgres-backed repo would
// expose, so swapping this for a real DB (see schema.sql) touches only this file.

const now = () => new Date().toISOString();

export function createStore() {
  const users = new Map();          // id -> user
  const tokens = new Map();         // token -> userId
  const guardians = new Map();      // id -> guardian
  const alerts = new Map();         // id -> alert
  const pings = new Map();          // alertId -> ping[]
  const media = new Map();          // alertId -> mediaSegment[]
  const notifications = new Map();  // id -> notification
  const idempotency = new Map();    // key -> alertId
  const watchTokens = new Map();    // watchToken -> alertId (recipient share links)

  return {
    // ---- persistence (JSON snapshot; swap for Postgres via schema.sql) ----
    dump() {
      const m = (map) => [...map.entries()];
      return { users: m(users), tokens: m(tokens), guardians: m(guardians), alerts: m(alerts),
        pings: m(pings), media: m(media), notifications: m(notifications),
        idempotency: m(idempotency), watchTokens: m(watchTokens) };
    },
    load(data) {
      if (!data) return;
      const fill = (map, entries) => { map.clear(); for (const [k, v] of entries ?? []) map.set(k, v); };
      fill(users, data.users); fill(tokens, data.tokens); fill(guardians, data.guardians);
      fill(alerts, data.alerts); fill(pings, data.pings); fill(media, data.media);
      fill(notifications, data.notifications); fill(idempotency, data.idempotency);
      fill(watchTokens, data.watchTokens);
    },

    // ---- watch tokens ----
    setWatchToken(token, alertId) { watchTokens.set(token, alertId); },
    getAlertByWatchToken(token) {
      const id = watchTokens.get(token);
      return id ? alerts.get(id) ?? null : null;
    },
    listAlertsByOwner(ownerId) {
      return [...alerts.values()].filter((a) => a.ownerId === ownerId)
        .sort((a, b) => (b.triggeredAt ?? '').localeCompare(a.triggeredAt ?? ''));
    },

    // ---- users / auth ----
    createUser({ displayName, phone, email = null, photoUrl = null }) {
      const id = uuid();
      const user = { id, displayName, phone, email, photoUrl, createdAt: now() };
      users.set(id, user);
      const token = uuid();
      tokens.set(token, id);
      return { user, token };
    },
    getUser(id) { return users.get(id) ?? null; },
    getUserByToken(token) {
      const uid = tokens.get(token);
      return uid ? users.get(uid) ?? null : null;
    },

    // ---- guardians (trusted network) ----
    addGuardian(ownerId, { name, phone, guardianId = null, channelPref = 'both', priorityTier = 1, relationship = null }) {
      const id = uuid();
      const g = { id, ownerId, guardianId, name, phone, channelPref, priorityTier, relationship, status: 'active', createdAt: now() };
      guardians.set(id, g);
      return g;
    },
    listGuardians(ownerId, { tier = null } = {}) {
      return [...guardians.values()].filter(
        (g) => g.ownerId === ownerId && g.status === 'active' && (tier == null || g.priorityTier === tier)
      );
    },

    // ---- alerts ----
    getAlertByIdempotencyKey(key) {
      const id = idempotency.get(key);
      return id ? alerts.get(id) ?? null : null;
    },
    createAlert(alert, idempotencyKey = null) {
      const id = uuid();
      const record = { id, ...alert, createdAt: now() };
      alerts.set(id, record);
      pings.set(id, []);
      media.set(id, []);
      if (idempotencyKey) idempotency.set(idempotencyKey, id);
      return record;
    },
    getAlert(id) { return alerts.get(id) ?? null; },
    updateAlert(id, patch) {
      const a = alerts.get(id);
      if (!a) return null;
      Object.assign(a, patch);
      return a;
    },

    // ---- location pings ----
    addPing(alertId, ping) {
      const arr = pings.get(alertId);
      if (!arr) return null;
      const record = { ...ping, receivedAt: now() };
      arr.push(record);
      return record;
    },
    listPings(alertId) { return pings.get(alertId) ?? []; },

    // ---- media (evidence) ----
    addMedia(alertId, segment) {
      const arr = media.get(alertId);
      if (!arr) return null;
      const record = { id: uuid(), ...segment, uploadedAt: now() };
      arr.push(record);
      return record;
    },
    listMedia(alertId) { return media.get(alertId) ?? []; },

    // ---- notification ledger (fan-out) ----
    createNotification(n) {
      const id = uuid();
      const record = { id, ...n, createdAt: now() };
      notifications.set(id, record);
      return record;
    },
    updateNotification(id, patch) {
      const n = notifications.get(id);
      if (!n) return null;
      Object.assign(n, patch);
      return n;
    },
    listNotifications(alertId) {
      return [...notifications.values()].filter((n) => n.alertId === alertId);
    },
  };
}

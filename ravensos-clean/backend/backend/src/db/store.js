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
  const pushSubs = new Map();        // endpoint -> { userId, subscription }

  return {
    // ---- persistence (JSON snapshot; swap for Postgres via schema.sql) ----
    dump() {
      const m = (map) => [...map.entries()];
      return { users: m(users), tokens: m(tokens), guardians: m(guardians), alerts: m(alerts),
        pings: m(pings), media: m(media), notifications: m(notifications),
        idempotency: m(idempotency), watchTokens: m(watchTokens), pushSubs: m(pushSubs) };
    },
    load(data) {
      if (!data) return;
      const fill = (map, entries) => { map.clear(); for (const [k, v] of entries ?? []) map.set(k, v); };
      fill(users, data.users); fill(tokens, data.tokens); fill(guardians, data.guardians);
      fill(alerts, data.alerts); fill(pings, data.pings); fill(media, data.media);
      fill(notifications, data.notifications); fill(idempotency, data.idempotency);
      fill(watchTokens, data.watchTokens); fill(pushSubs, data.pushSubs);
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
    createUser({ displayName, phone, passwordHash = null, email = null, photoUrl = null }) {
      const id = uuid();
      // Short, human-shareable invite code (unique).
      let inviteCode;
      do { inviteCode = Math.random().toString(36).slice(2, 8).toUpperCase(); }
      while ([...users.values()].some((u) => u.inviteCode === inviteCode));
      const user = { id, displayName, phone, passwordHash, inviteCode, email, photoUrl, createdAt: now() };
      users.set(id, user);
      // Auto-link: if anyone already added this phone as a plain contact, turn it
      // into a pending guardian request now that the person has an account.
      const norm = (p) => (p || '').replace(/[^\d]/g, '');
      for (const g of guardians.values()) {
        if (!g.guardianUserId && g.ownerId !== id && norm(g.phone) === norm(phone)) {
          g.guardianUserId = id;
          g.status = 'pending';
        }
      }
      return user;
    },
    createSession(userId) {
      const token = uuid();
      tokens.set(token, userId);
      return token;
    },
    getUser(id) { return users.get(id) ?? null; },
    getUserByToken(token) {
      const uid = tokens.get(token);
      return uid ? users.get(uid) ?? null : null;
    },
    getUserByPhone(phone) {
      const norm = (p) => (p || '').replace(/[^\d]/g, '');
      const target = norm(phone);
      return [...users.values()].find((u) => norm(u.phone) === target) ?? null;
    },
    findUser(query) {
      const q = (query || '').trim();
      if (!q) return null;
      const byCode = [...users.values()].find((u) => u.inviteCode === q.toUpperCase());
      if (byCode) return byCode;
      return this.getUserByPhone(q);
    },

    // ---- guardians (trusted network) ----
    // If the phone matches a registered user, the guardian link starts as a
    // 'pending' request that the other person must accept (consent). Otherwise
    // it's a plain contact and is active immediately.
    addGuardian(ownerId, { name, phone, channelPref = 'both', priorityTier = 1, relationship = null }) {
      const match = this.getUserByPhone(phone);
      const guardianUserId = match && match.id !== ownerId ? match.id : null;
      const id = uuid();
      const g = {
        id, ownerId, guardianUserId, name, phone, channelPref, priorityTier, relationship,
        status: guardianUserId ? 'pending' : 'active', createdAt: now(),
      };
      guardians.set(id, g);
      return g;
    },
    listGuardians(ownerId, { tier = null, includePending = false } = {}) {
      return [...guardians.values()].filter(
        (g) => g.ownerId === ownerId
          && (includePending || g.status === 'active')
          && (tier == null || g.priorityTier === tier)
      );
    },
    removeGuardian(ownerId, id) {
      const g = guardians.get(id);
      if (!g || g.ownerId !== ownerId) return false;
      guardians.delete(id);
      return true;
    },
    // Incoming requests: people who added ME as their guardian, still pending.
    listIncomingRequests(userId) {
      return [...guardians.values()]
        .filter((g) => g.guardianUserId === userId && g.status === 'pending')
        .map((g) => {
          const owner = users.get(g.ownerId);
          return { id: g.id, ownerName: owner?.displayName ?? 'Someone', ownerPhone: owner?.phone ?? null, createdAt: g.createdAt };
        });
    },
    respondToRequest(userId, guardianId, accept) {
      const g = guardians.get(guardianId);
      if (!g || g.guardianUserId !== userId || g.status !== 'pending') return false;
      if (accept) g.status = 'active';
      else guardians.delete(guardianId);
      return true;
    },

    // ---- web push subscriptions (per user, keyed by endpoint) ----
    addPushSubscription(userId, subscription) {
      if (!subscription || !subscription.endpoint) return false;
      pushSubs.set(subscription.endpoint, { userId, subscription, createdAt: now() });
      return true;
    },
    listPushSubscriptions(userId) {
      return [...pushSubs.values()].filter((s) => s.userId === userId).map((s) => s.subscription);
    },
    removePushSubscription(endpoint) { pushSubs.delete(endpoint); },

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

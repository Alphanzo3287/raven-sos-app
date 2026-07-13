import { Router } from 'express';
import { z } from 'zod';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { authMiddleware } from '../middleware/auth.js';
import { config } from '../config.js';

// Validation helper
const parse = (schema, body) => {
  const r = schema.safeParse(body);
  if (!r.success) throw Object.assign(new Error('validation'), { status: 400, details: r.error.flatten() });
  return r.data;
};

// Password hashing with Node's built-in scrypt (no dependency).
function hashPassword(pw) {
  const salt = randomBytes(16);
  return salt.toString('hex') + ':' + scryptSync(pw, salt, 64).toString('hex');
}
function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  const dk = scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  const target = Buffer.from(hashHex, 'hex');
  return dk.length === target.length && timingSafeEqual(dk, target);
}

// Public view of a user — never leak the password hash.
const publicUser = (u) => u && ({ id: u.id, displayName: u.displayName, phone: u.phone, inviteCode: u.inviteCode });

export function buildRoutes(store, alertService) {
  const router = Router();
  const auth = authMiddleware(store);

  // ---- auth (phone + password) ----
  router.post('/auth/register', (req, res) => {
    const data = parse(z.object({
      displayName: z.string().min(1),
      phone: z.string().min(3),
      password: z.string().min(6),
    }), req.body);
    if (store.getUserByPhone(data.phone)) {
      return res.status(409).json({ error: 'An account with that phone number already exists. Try logging in.' });
    }
    const user = store.createUser({ displayName: data.displayName, phone: data.phone, passwordHash: hashPassword(data.password) });
    const token = store.createSession(user.id);
    res.status(201).json({ token, user: publicUser(user) });
  });

  router.post('/auth/login', (req, res) => {
    const data = parse(z.object({ phone: z.string().min(3), password: z.string().min(1) }), req.body);
    const user = store.getUserByPhone(data.phone);
    if (!user || !verifyPassword(data.password, user.passwordHash)) {
      return res.status(401).json({ error: 'Wrong phone number or password.' });
    }
    const token = store.createSession(user.id);
    res.json({ token, user: publicUser(user) });
  });

  router.get('/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

  // Look up another Raven SOS user by phone number or invite code.
  router.get('/users/find', auth, (req, res) => {
    const found = store.findUser(req.query.q);
    if (!found || found.id === req.user.id) return res.status(404).json({ error: 'No Raven SOS user found for that.' });
    res.json({ user: { id: found.id, displayName: found.displayName, phone: found.phone } });
  });

  // ---- web push ----
  router.get('/push/vapid-key', (req, res) => res.json({ publicKey: config.vapid.publicKey }));
  router.post('/push/subscribe', auth, (req, res) => {
    const data = parse(z.object({
      endpoint: z.string().url(),
      keys: z.object({ p256dh: z.string(), auth: z.string() }),
      expirationTime: z.any().optional(),
    }), req.body);
    store.addPushSubscription(req.user.id, { endpoint: data.endpoint, keys: data.keys });
    res.status(201).json({ subscribed: true });
  });

  // ---- guardian requests (incoming: people who added ME) ----
  router.get('/requests', auth, (req, res) => res.json({ requests: store.listIncomingRequests(req.user.id) }));
  router.post('/requests/:id/accept', auth, (req, res) => {
    if (!store.respondToRequest(req.user.id, req.params.id, true)) return res.status(404).json({ error: 'not found' });
    res.json({ accepted: true });
  });
  router.post('/requests/:id/decline', auth, (req, res) => {
    if (!store.respondToRequest(req.user.id, req.params.id, false)) return res.status(404).json({ error: 'not found' });
    res.json({ declined: true });
  });

  // Public recipient view — open with a share token, no account needed.
  router.get('/watch/:token', (req, res) => {
    const alert = store.getAlertByWatchToken(req.params.token);
    if (!alert) return res.status(404).json({ error: 'not found' });
    const owner = store.getUser(alert.ownerId);
    res.json({
      alert,
      ownerName: owner?.displayName ?? 'Someone',
      pings: store.listPings(alert.id),
      notifications: store.listNotifications(alert.id).map((n) => ({ channel: n.channel, status: n.status, recipientId: n.recipientId })),
    });
  });

  // ---- guardians ----
  router.post('/guardians', auth, (req, res) => {
    const data = parse(z.object({
      name: z.string().min(1),
      phone: z.string().min(3),
      channelPref: z.enum(['push', 'sms', 'both']).default('both'),
      priorityTier: z.number().int().min(1).max(3).default(1),
      relationship: z.string().optional(),
    }), req.body);
    res.status(201).json(store.addGuardian(req.user.id, data));
  });

  router.get('/guardians', auth, (req, res) => {
    res.json(store.listGuardians(req.user.id, { includePending: true }));
  });

  router.delete('/guardians/:id', auth, (req, res) => {
    const ok = store.removeGuardian(req.user.id, req.params.id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ removed: true });
  });

  // ---- alerts ----
  router.post('/alerts', auth, async (req, res, next) => {
    try {
      const data = parse(z.object({
        lat: z.number(),
        lng: z.number(),
        accuracyM: z.number().optional(),
        address: z.string().optional(),
        triggerType: z.enum(['manual', 'countdown', 'duress', 'hardware', 'voice', 'fob', 'fake_shutdown']).default('manual'),
        isSilent: z.boolean().default(false),
        origin: z.string().optional(),
      }), req.body);
      const idempotencyKey = req.headers['idempotency-key'] ?? null;
      const result = await alertService.trigger({ ownerId: req.user.id, ...data, idempotencyKey });
      res.status(201).json({
        ...result,
        mapLinks: {
          google: config.mapLinks.google(data.lat, data.lng),
          waze: config.mapLinks.waze(data.lat, data.lng),
          apple: config.mapLinks.apple(data.lat, data.lng),
        },
      });
    } catch (e) { next(e); }
  });

  router.get('/alerts', auth, (req, res) => {
    res.json({ alerts: store.listAlertsByOwner(req.user.id) });
  });

  router.get('/alerts/:id', auth, (req, res) => {
    const alert = store.getAlert(req.params.id);
    if (!alert) return res.status(404).json({ error: 'not found' });
    res.json({
      alert,
      pings: store.listPings(alert.id),
      media: store.listMedia(alert.id),
      notifications: store.listNotifications(alert.id),
    });
  });

  router.post('/alerts/:id/ack', auth, (req, res) => {
    const { guardianId } = parse(z.object({ guardianId: z.string() }), req.body);
    res.json(alertService.acknowledge({ alertId: req.params.id, guardianId }));
  });

  router.post('/alerts/:id/pings', auth, (req, res) => {
    const data = parse(z.object({
      lat: z.number(), lng: z.number(),
      accuracyM: z.number().optional(),
      speedMps: z.number().optional(),
      headingDeg: z.number().optional(),
      recordedAt: z.string().optional(),
    }), req.body);
    res.status(201).json(alertService.addPing({ alertId: req.params.id, ...data }));
  });

  router.post('/alerts/:id/media', auth, (req, res) => {
    const data = parse(z.object({
      kind: z.enum(['audio', 'video']),
      seq: z.number().int(),
      s3Key: z.string(),
      durationMs: z.number().optional(),
      sha256: z.string().optional(),
    }), req.body);
    res.status(201).json(alertService.addMedia({ alertId: req.params.id, ...data }));
  });

  router.post('/alerts/:id/dispatch911', auth, async (req, res, next) => {
    try { res.json(await alertService.dispatch911({ alertId: req.params.id })); }
    catch (e) { next(e); }
  });

  router.post('/alerts/:id/resolve', auth, (req, res) => {
    const { resolution } = parse(z.object({
      resolution: z.enum(['safe', 'false_alarm', 'responded', 'unknown']).default('safe'),
    }), req.body);
    res.json(alertService.resolve({ alertId: req.params.id, resolution }));
  });

  return router;
}

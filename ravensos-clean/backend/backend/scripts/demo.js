import { buildServer } from '../src/index.js';
import { WebSocket } from 'ws';

// Boots the real server in-process and drives it over HTTP + WebSocket exactly
// like the mobile app and a recipient's phone would, printing the whole flow.

const PORT = 4055;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const line = (s = '') => console.log(s);
const step = (n, s) => console.log(`\n${'─'.repeat(60)}\n▶ STEP ${n}: ${s}\n${'─'.repeat(60)}`);

async function api(path, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  const { server } = buildServer();
  await new Promise((r) => server.listen(PORT, r));
  line(`Guardian backend up on ${BASE}\n`);

  // 1. The person in danger registers.
  step(1, 'Register the protected user (Aaliyah)');
  const { token, user } = await api('/api/auth/register', {
    method: 'POST',
    body: { displayName: 'Aaliyah Carter', phone: '+13105551212' },
  });
  line(`  user id: ${user.id}`);

  // 2. Build the guardian network (tier 1 = notify now, tier 2 = escalate).
  step(2, 'Add guardians (2 tier-1, 1 tier-2)');
  const sister = await api('/api/guardians', { method: 'POST', token, body: { name: 'Jasmine (sister)', phone: '+13105550001', channelPref: 'both', priorityTier: 1, relationship: 'sister' } });
  const neighbor = await api('/api/guardians', { method: 'POST', token, body: { name: 'Marcus (neighbor)', phone: '+13105550002', channelPref: 'sms', priorityTier: 1, relationship: 'neighbor' } });
  await api('/api/guardians', { method: 'POST', token, body: { name: 'Uncle Ray', phone: '+13105550003', channelPref: 'both', priorityTier: 2, relationship: 'uncle' } });
  line('  tier-1: Jasmine (push+sms), Marcus (sms)');
  line('  tier-2: Uncle Ray (escalation only)');

  // 3. Trigger the alert. Note the mock SMS/push lines the notifiers print.
  step(3, 'Trigger emergency alert (with idempotency key)');
  const idem = 'demo-trigger-001';
  const triggerBody = { lat: 34.0195, lng: -118.4912, accuracyM: 8, address: '1200 Ocean Ave, Santa Monica, CA', triggerType: 'manual' };
  const first = await api('/api/alerts', { method: 'POST', token, body: triggerBody, headers: { 'Idempotency-Key': idem } });
  const alertId = first.alert.id;
  const watchToken = first.watchToken;
  line(`\n  alert id: ${alertId}`);
  line(`  notified tier-1 recipients: ${first.notifiedTier1}`);
  line(`  recipient watch link token: ${watchToken}`);
  line(`  google map link: ${first.mapLinks.google}`);

  // 3b. Prove idempotency: same key -> same alert, no duplicate fan-out.
  const dup = await api('/api/alerts', { method: 'POST', token, body: triggerBody, headers: { 'Idempotency-Key': idem } });
  line(`  retry with same idempotency key deduped: ${dup.deduped} (same id: ${dup.alert.id === alertId})`);

  // 4. A recipient opens the live view over WebSocket and watches Aaliyah move.
  step(4, 'Recipient connects via WebSocket and receives live location');
  const ws = new WebSocket(`ws://localhost:${PORT}/ws?alertId=${alertId}&token=${token}`);
  const received = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'snapshot') line(`  [recipient] snapshot: status=${msg.alert.status}, pings so far=${msg.pings.length}`);
    if (msg.type === 'ping') { received.push(msg.ping); line(`  [recipient] live ping #${received.length}: ${msg.ping.lat.toFixed(5)}, ${msg.ping.lng.toFixed(5)}`); }
    if (msg.type === 'status') line(`  [recipient] status update: ${msg.alert.status}`);
  });
  await new Promise((r) => ws.on('open', r));

  // 4b. A guardian WITHOUT an account opens the share link (watch token).
  const wsWatch = new WebSocket(`ws://localhost:${PORT}/ws?watch=${watchToken}`);
  const watcherPings = [];
  wsWatch.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.type === 'ping') watcherPings.push(m.ping); });
  await new Promise((r) => wsWatch.on('open', r));
  line('  [guardian via share link] connected with no account — watching live');

  // 5. Device streams a moving track (someone being taken down the street).
  step(5, 'Device streams a moving location track');
  const track = [
    [34.0195, -118.4912], [34.0199, -118.4908], [34.0206, -118.4901], [34.0214, -118.4893], [34.0223, -118.4884],
  ];
  for (const [lat, lng] of track) {
    await api(`/api/alerts/${alertId}/pings`, { method: 'POST', token, body: { lat, lng, accuracyM: 6, speedMps: 3.1 } });
    await sleep(120);
  }

  // 6. Evidence: a cloud-backed audio chunk lands.
  step(6, 'Cloud-backed audio evidence chunk uploaded');
  const seg = await api(`/api/alerts/${alertId}/media`, { method: 'POST', token, body: { kind: 'audio', seq: 0, s3Key: `alerts/${alertId}/audio/0.aac`, durationMs: 8000, sha256: 'demo-hash' } });
  line(`  stored segment: ${seg.s3Key} (sha256=${seg.sha256})`);

  // 7. A guardian acknowledges -> escalation is canceled.
  step(7, 'Guardian acknowledges (cancels escalation)');
  const acked = await api(`/api/alerts/${alertId}/ack`, { method: 'POST', token, body: { guardianId: sister.id } });
  line(`  Jasmine acknowledged. alert status: ${acked.status}`);

  // 8. Monitoring agent verifies a real emergency -> 911 via RapidSOS (mocked).
  step(8, 'Verified emergency dispatched to 911 via RapidSOS bridge (mock)');
  const dispatched = await api(`/api/alerts/${alertId}/dispatch911`, { method: 'POST', token });
  line(`  status: ${dispatched.status}, incident: ${dispatched.rapidsosIncidentId}`);

  // 9. Resolve.
  step(9, 'Resolve the alert');
  const resolved = await api(`/api/alerts/${alertId}/resolve`, { method: 'POST', token, body: { resolution: 'responded' } });
  line(`  status: ${resolved.status}, resolution: ${resolved.resolution}`);

  await sleep(150);

  // Final assertions.
  step('✓', 'Verify end state');
  const full = await api(`/api/alerts/${alertId}`, { token });
  const me = await api('/api/me', { token });
  const history = await api('/api/alerts', { token });
  const publicWatch = await api(`/api/watch/${watchToken}`);
  const checks = [
    ['alert resolved', full.alert.status === 'resolved'],
    ['5 location pings stored', full.pings.length === 5],
    ['recipient (account) received all 5 live pings over WS', received.length === 5],
    ['guardian via share link received all 5 live pings', watcherPings.length === 5],
    ['public watch endpoint returns owner name + pings', publicWatch.ownerName === 'Aaliyah Carter' && publicWatch.pings.length === 5],
    ['/me returns the session user', me.user?.id === user.id],
    ['alert history lists the alert', history.alerts.some((a) => a.id === alertId)],
    ['1 audio segment stored', full.media.length === 1],
    ['911 dispatched flag set', full.alert.dispatched911 === true],
    ['at least one notification acknowledged', full.notifications.some((n) => n.status === 'acknowledged')],
    ['fan-out produced notification ledger rows', full.notifications.length >= 2],
  ];
  let ok = true;
  for (const [label, pass] of checks) { line(`  ${pass ? '✓' : '✗'} ${label}`); if (!pass) ok = false; }

  ws.close();
  wsWatch.close();
  server.close();
  line(`\n${ok ? '✅ ALL CHECKS PASSED — core alert loop works end-to-end.' : '❌ SOME CHECKS FAILED.'}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('DEMO FAILED:', e); process.exit(1); });

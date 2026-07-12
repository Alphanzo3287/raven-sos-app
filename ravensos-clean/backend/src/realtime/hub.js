import { WebSocketServer } from 'ws';

// Recipients subscribe to a specific alert and receive live pings + status
// changes. Redis pub/sub would sit here in production to fan across instances;
// for a single node an in-process map is enough.

export function createHub(httpServer, store) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const rooms = new Map(); // alertId -> Set<ws>

  function join(alertId, ws) {
    if (!rooms.has(alertId)) rooms.set(alertId, new Set());
    rooms.get(alertId).add(ws);
  }
  function leave(ws) {
    for (const set of rooms.values()) set.delete(ws);
  }
  function broadcast(alertId, message) {
    const set = rooms.get(alertId);
    if (!set) return 0;
    const payload = JSON.stringify(message);
    let n = 0;
    for (const ws of set) {
      if (ws.readyState === ws.OPEN) { ws.send(payload); n++; }
    }
    return n;
  }

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const watch = url.searchParams.get('watch');
    const token = url.searchParams.get('token');

    // Two ways in: a registered user's token, or an alert's share ("watch") token.
    let alert = null;
    if (watch) {
      alert = store.getAlertByWatchToken(watch);
    } else {
      const user = token ? store.getUserByToken(token) : null;
      const alertId = url.searchParams.get('alertId');
      if (user && alertId) alert = store.getAlert(alertId);
    }
    if (!alert) {
      ws.send(JSON.stringify({ type: 'error', message: 'invalid alert or credentials' }));
      ws.close();
      return;
    }
    const alertId = alert.id;

    join(alertId, ws);
    // Send current snapshot immediately so late joiners aren't blind.
    ws.send(JSON.stringify({
      type: 'snapshot',
      alert,
      pings: store.listPings(alertId),
    }));

    ws.on('close', () => leave(ws));
    ws.on('error', () => leave(ws));
  });

  return {
    broadcastPing: (alertId, ping) => broadcast(alertId, { type: 'ping', alertId, ping }),
    broadcastStatus: (alertId, alert) => broadcast(alertId, { type: 'status', alertId, alert }),
    subscriberCount: (alertId) => rooms.get(alertId)?.size ?? 0,
  };
}

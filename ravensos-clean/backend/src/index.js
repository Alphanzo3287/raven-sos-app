import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { createStore } from './db/store.js';
import { createHub } from './realtime/hub.js';
import { createAlertService } from './services/alerts.js';
import { createApp } from './app.js';

const DATA_FILE = process.env.DATA_FILE || path.join(process.cwd(), 'data.json');

// Dependency order: hub needs the raw http server; alert service needs the hub;
// app needs the service. Build the server first, attach the app afterward.
export function buildServer() {
  const store = createStore();

  // Load persisted state so the product remembers across restarts.
  try {
    if (fs.existsSync(DATA_FILE)) {
      store.load(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
      console.log(`Loaded persisted data from ${DATA_FILE}`);
    }
  } catch (e) { console.warn('Could not load data file:', e.message); }

  const server = http.createServer();
  const hub = createHub(server, store);
  const alertService = createAlertService(store, hub);
  const app = createApp(store, alertService);
  server.on('request', app);

  // Snapshot to disk periodically and on shutdown.
  const save = () => { try { fs.writeFileSync(DATA_FILE, JSON.stringify(store.dump())); } catch (e) { console.warn('save failed', e.message); } };
  const interval = setInterval(save, 2000);
  const shutdown = () => { clearInterval(interval); save(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { server, store, alertService, hub, save };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { server } = buildServer();
  server.listen(config.port, () => {
    console.log(`Raven SOS backend on http://localhost:${config.port}`);
    console.log(`WebSocket: ws://localhost:${config.port}/ws?alertId=...&token=...  (or ?watch=<token>)`);
  });
}

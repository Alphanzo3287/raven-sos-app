import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { createStore } from './db/store.js';
import { createHub } from './realtime/hub.js';
import { createAlertService } from './services/alerts.js';
import { createApp } from './app.js';

// --- persistence config (read straight from the environment) ---
const DATA_FILE = process.env.DATA_FILE || path.join(process.cwd(), 'data.json');
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const USE_SUPABASE = !!(SB_URL && SB_KEY);

// Build the server (sync). Persistence attaches after, so we can load a durable
// snapshot before accepting traffic.
export function buildServer() {
  const store = createStore();
  const server = http.createServer();
  const hub = createHub(server, store);
  const alertService = createAlertService(store, hub);
  const app = createApp(store, alertService);
  server.on('request', app);
  return { server, store, alertService, hub };
}

// --- Supabase snapshot via the built-in REST API (no library needed) ---
async function sbLoad() {
  const res = await fetch(`${SB_URL}/rest/v1/raven_state?id=eq.1&select=data`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(`load HTTP ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return rows[0]?.data ?? null;
}
async function sbSave(dump) {
  const res = await fetch(`${SB_URL}/rest/v1/raven_state?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ id: 1, data: dump, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`save HTTP ${res.status}: ${await res.text()}`);
}

async function attachPersistence(store) {
  if (USE_SUPABASE) {
    try {
      const snap = await sbLoad();
      if (snap) { store.load(snap); console.log('Loaded snapshot from Supabase'); }
      else console.log('No Supabase snapshot yet — starting fresh');
    } catch (e) { console.warn('Supabase load error:', e.message); }

    let firstOk = true;
    const save = async () => {
      try { await sbSave(store.dump()); if (firstOk) { firstOk = false; console.log('Supabase: first snapshot saved OK'); } }
      catch (e) { console.warn('Supabase save failed:', e.message); }
    };
    const interval = setInterval(save, 5000);
    const shutdown = async () => { clearInterval(interval); await save(); process.exit(0); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    console.log('Persistence: Supabase snapshot (durable)');
  } else {
    try {
      if (fs.existsSync(DATA_FILE)) { store.load(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); }
    } catch (e) { console.warn('Could not load data file:', e.message); }
    const save = () => { try { fs.writeFileSync(DATA_FILE, JSON.stringify(store.dump())); } catch (e) { console.warn('save failed', e.message); } };
    const interval = setInterval(save, 2000);
    const shutdown = () => { clearInterval(interval); save(); process.exit(0); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    console.log('Persistence: local JSON file (set SUPABASE_URL + SUPABASE_SERVICE_KEY for durable storage)');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { server, store } = buildServer();
  await attachPersistence(store);
  server.listen(config.port, () => console.log(`Raven SOS backend on http://localhost:${config.port}`));
}

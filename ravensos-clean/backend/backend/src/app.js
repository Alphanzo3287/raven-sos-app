import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRoutes } from './routes/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBAPP_DIR = path.resolve(__dirname, '../../webapp');

export function createApp(store, alertService) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // CORS: open for the local web demo. Lock this down in production.
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', buildRoutes(store, alertService));

  // Serve the functional web app (so it runs on localhost — a secure context
  // where the browser allows geolocation).
  app.use(express.static(WEBAPP_DIR));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message ?? 'internal', details: err.details });
  });

  return app;
}

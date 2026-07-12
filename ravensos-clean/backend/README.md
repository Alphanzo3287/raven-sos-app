# Guardian Backend

Node (ESM) service for the core alert loop. Runs with zero external services;
real providers activate via env vars.

## Run
```bash
npm install
npm run demo    # full end-to-end integration demo
npm start       # server on :4000
```

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create user, mint token (OTP in prod) |
| POST | `/api/guardians` | Add a guardian (tier 1 = now, tier 2 = escalate) |
| GET  | `/api/guardians` | List guardians |
| POST | `/api/alerts` | Trigger alert + fan out. Honors `Idempotency-Key` header |
| GET  | `/api/alerts/:id` | Alert + pings + media + notification ledger |
| POST | `/api/alerts/:id/ack` | Guardian acknowledges → cancels escalation |
| POST | `/api/alerts/:id/pings` | Append a live location ping (broadcast over WS) |
| POST | `/api/alerts/:id/media` | Register a cloud-stored evidence segment |
| POST | `/api/alerts/:id/dispatch911` | Verified → RapidSOS bridge |
| POST | `/api/alerts/:id/resolve` | Resolve alert |

WebSocket: `ws://localhost:4000/ws?alertId=<id>&token=<token>` →
`snapshot`, `ping`, and `status` messages.

## Env (all optional — omit to run in mock mode)
```
PORT=4000
ESCALATION_MS=60000
TWILIO_ACCOUNT_SID=...  TWILIO_AUTH_TOKEN=...  TWILIO_FROM=+1...
FCM_SERVICE_ACCOUNT_JSON={...}
RAPIDSOS_API_KEY=...
```

## Architecture notes
- `src/db/store.js` — in-memory repos mirroring `src/db/schema.sql` (Postgres/PostGIS). Swap here for production.
- `src/services/fanout.js` — parallel multi-channel dispatch, ledger, escalation timer.
- `src/services/alerts.js` — alert lifecycle.
- `src/realtime/hub.js` — WebSocket broadcasting (Redis pub/sub in prod for multi-node).
- `src/services/notifiers.js` — Twilio/FCM adapters with retry+backoff; mock when unconfigured.

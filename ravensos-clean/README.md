# Guardian

A personal-safety alert app: one tap (or a hands-free trigger) fans out an
identity + live location + evidence alert to a trusted network, streams the
person's movement in real time, and has a path to 911 via RapidSOS.

This repo is the **codeable core, running for real** — Phases 1–3 of the
architecture spec (`docs/architecture.md`). The backend has been run end-to-end
and passes a full-loop integration demo.

## What's here

```
guardian/
├── backend/      Node backend — alert loop, fan-out, live streaming, persistence, 911 bridge stub
│   ├── src/      services, routes, realtime hub, store (JSON persistence) + Postgres schema
│   └── scripts/  demo.js — drives the whole flow end-to-end
├── webapp/       ★ THE LIVING PRODUCT — functional Raven SOS web app (served by the backend)
├── mobile/       Flutter client — panic button, offline outbox, location streaming, API layer
├── web-demo/     Live response console (Leaflet map) — simulation + live-backend modes
└── docs/         Full architecture spec
```

## Run the living product

```bash
cd backend
npm install
npm start        # http://localhost:4000
```

Then **open http://localhost:4000** in your browser. The backend serves the real
app (on localhost, so the browser allows geolocation). You can:

1. Create a safety profile (name + phone) — it seeds two demo guardians.
2. Add/manage guardians (real API).
3. **Press and hold the SOS orb** → countdown → a real alert fires and fans out to
   your guardians (mock SMS/push printed in the server console).
4. Your **real location streams live**; watch it move on the map.
5. Copy the **guardian watch link** and open it on your phone (use your LAN IP,
   e.g. `http://192.168.x.x:4000/?watch=...`) — a guardian sees the live map move
   with no account needed, plus Google Maps / Waze navigation.
6. Tap **"I'm safe"** to resolve. See it in **History** with a full timeline.

Data persists to `backend/data.json` across restarts.

**End-to-end test** (proves the whole loop, incl. the watch flow):
```bash
npm run demo
```

**Web console** — `web-demo/index.html` (design/testing tool; simulation + live modes).

**Mobile** (Flutter ≥ 3.3):
```bash
cd mobile
flutter pub get
flutter run --dart-define=API_BASE=http://<your-LAN-ip>:4000
```

## What works today (a real, usable app — proven by `npm run demo`, 11/11 checks)

- **Functional web app**: onboarding, home, guardians, live SOS, active emergency, watch link, history
- Register user + build a tiered guardian network (persists across restarts)
- Press-and-hold SOS → countdown → alert → **parallel push + SMS fan-out** to tier-1
- **Idempotency**: a retried trigger collapses to one alert (offline-safe)
- **Real live location streaming** (browser geolocation) over WebSocket — on the sender screen and the guardian watch link
- **No-account guardian watch link** with a live map + Google Maps / Waze navigation
- Cloud-backed **evidence** segments recorded against the alert
- **Acknowledgement cancels escalation**; unacknowledged alerts escalate to tier-2 + monitoring handoff
- **911 dispatch** through the RapidSOS bridge (mocked until the partnership is live)
- Full **notification ledger** + **incident history/timeline** from real data

Providers run in **mock mode** with zero config and print what they'd send.
Set the env vars below to activate the real ones.

## The punch-list only YOU can complete (not code)

| Item | Why it's gated | Env var |
|---|---|---|
| **SMS** | Twilio account + number | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` |
| **Push** | Firebase project + service account; Apple Push cert | `FCM_SERVICE_ACCOUNT_JSON` |
| **911 dispatch** | **RapidSOS partnership** + a 24/7 monitoring center contract | `RAPIDSOS_API_KEY` |
| **App Store / Play** | Apple Developer + Google Play accounts, review | — |
| **Audio recording** | Legal review — many US states require all-party consent | — |
| **BLE forensic mode** | Privacy-law review; ships last | — |

## Next build steps

1. Swap the in-memory store for Postgres (`src/db/schema.sql` is ready) — touches only `src/db/store.js`.
2. Real OTP auth (replace the register stub) + push-token registration.
3. Hands-free triggers (iOS Back Tap / Action Button / Watch; Android key combos; BLE fob).
4. Duress PIN + cancelable countdown in the client.
5. RapidSOS + monitoring-center integration (partnership-gated).
6. Community/mutual-aid layer with the anti-profiling guardrails in the spec.

See `docs/architecture.md` for the full data model, fan-out logic, and rationale.

# Guardian — MVP Architecture Spec

*Working codename "Guardian" — rename freely. A personal-safety alert app: one tap (or hands-free trigger) fans out an identity + live location + evidence alert to a trusted network, with an optional community broadcast layer and a path to 911 via RapidSOS.*

> Decisions I made for you where the brief was open are marked **[DECISION]**. Things you must not skip are marked **[MUST]**. Things that will bite you legally or technically are marked **[WATCH]**.

---

## 0. Guiding principles

1. **It has to fire on a bad connection.** The alert is queued locally and retried; it degrades to a plain SMS with a map link if data fails. Never require good signal.
2. **Evidence leaves the device before the device can be taken.** Stream, don't store-and-hope.
3. **False alarms are the real enemy.** A human verification step is what keeps police and the community responsive. Design for it from day one.
4. **The community layer must not become a profiling tool.** More on this in §9 — it's a design and moral requirement, not an afterthought, given who this is meant to protect.

---

## 1. System components

| Component | Role | MVP choice **[DECISION]** |
|---|---|---|
| Mobile app | Trigger, capture location/audio, stream, receive alerts | **Flutter** (one codebase, good native-channel escape hatches) |
| API backend | Auth, alert creation, fan-out orchestration | **Node/TypeScript** (NestJS) or **Go** |
| Realtime layer | Live location + status to recipients | **WebSocket** service + Redis pub/sub |
| Push | Wake recipient devices | **FCM** (Android) + **APNs** (iOS) |
| SMS/voice fallback | Reach recipients without the app | **Twilio** |
| Datastore | Users, contacts, alerts | **Postgres** (+ PostGIS for geo) |
| Time-series/hot state | Location pings, live alert state | **Redis** (hot) → Postgres (cold archive) |
| Media storage | Audio/video evidence | **S3-compatible**, write-once, server-side encrypted |
| Maps | Recipient navigation | Deep links to Google/Apple/Waze (no SDK needed) |
| 911 bridge | Verified dispatch | **RapidSOS Emergency API** + monitoring center (§10) |

**Why Postgres + PostGIS:** the community layer (§9) needs "find users within N meters of a point," which is a native PostGIS query. Firebase/Firestore is faster to start but its geo story is weaker and you'll fight it later. If you want maximum speed-to-MVP over the geo layer, Firebase is acceptable for phases 1–2 and you migrate before phase 5.

---

## 2. Data model

Core entities. Types are illustrative (Postgres flavor).

### `users`
```
id              uuid  pk
display_name    text            # sent in the alert
phone           text  unique    # verified via OTP
email           text
photo_url       text            # optional, helps recipients/responders
medical_notes   text            # optional; shared to 911 via RapidSOS only
duress_pin_hash text            # a PIN that SILENTLY triggers (see §8)
safe_pin_hash   text            # normal cancel PIN
created_at      timestamptz
```

### `guardians` (the trusted network — many-to-many, directional)
```
id              uuid  pk
owner_id        uuid  fk users        # the person being protected
guardian_id     uuid  fk users  null  # null if they're only an SMS contact
name            text                   # for non-app contacts
phone           text
channel_pref    enum(push, sms, both)  default both
priority_tier   smallint               # 1 = notify first/always, 2 = escalate to
relationship    text                   # 'sister', 'neighbor', etc.
status          enum(pending, active)  # they confirm to join
created_at      timestamptz
```
**[DECISION]** Guardians confirm membership (double opt-in) so you don't spam people and so recipients have the app installed ahead of time. Tier 1 fires immediately; tier 2 fires on escalation (unacknowledged after T seconds).

### `alerts` (the heart of the system)
```
id                uuid  pk
owner_id          uuid  fk users
status            enum  # see state machine §4
trigger_type      enum(manual, countdown, duress, hardware, voice, fob, fake_shutdown)
triggered_at      timestamptz
origin_lat        double
origin_lng        double
origin_accuracy_m float
origin_address    text          # reverse-geocoded at trigger
is_silent         bool          # duress mode: no sound/vibration/visible UI
verified_by       enum(none, self, agent)  default none
dispatched_911    bool  default false
rapidsos_incident_id text  null
resolved_at       timestamptz  null
resolution        enum(safe, false_alarm, responded, unknown)  null
```

### `location_pings` (the live track — time series)
```
id          bigserial pk
alert_id    uuid  fk alerts
lat         double
lng         double
accuracy_m  float
speed_mps   float  null
heading_deg float  null
recorded_at timestamptz     # device time
received_at timestamptz     # server time (for gap detection)
```
Hot pings live in Redis for the active alert; archived to Postgres on resolution. Recipients read the live track over WebSocket; the raw table is the forensic record.

### `media_segments` (evidence)
```
id           uuid pk
alert_id     uuid fk alerts
kind         enum(audio, video)
seq          int              # ordered chunks, 5–10s each
s3_key       text
duration_ms  int
started_at   timestamptz
uploaded_at  timestamptz
sha256       text             # integrity / chain-of-custody
```

### `alert_notifications` (fan-out ledger — one row per recipient per channel)
```
id            uuid pk
alert_id      uuid fk alerts
recipient_id  uuid fk guardians
channel       enum(push, sms, voice)
status        enum(queued, sent, delivered, failed, acknowledged)
provider_ref  text            # Twilio SID / FCM message id
sent_at       timestamptz
acknowledged_at timestamptz null
```
This ledger is what powers retries, de-duplication, and "who has seen this" in the UI.

### `nearby_devices` (BLE forensic mode — phase 6, lawyer-gated) **[WATCH]**
```
id           bigserial pk
alert_id     uuid fk alerts
device_id    text     # ephemeral BLE identifier (usually randomized)
device_name  text null
rssi         int      # proximity proxy
first_seen   timestamptz
last_seen    timestamptz
```
Set expectations: most phones randomize this and can't be tied to a person. Value is limited to non-randomizing accessories/IoT. Frame as investigative breadcrumb only, and don't ship without a privacy-law review — passively logging bystanders' Bluetooth can count as processing personal data.

### `incidents` (Citizen-style community layer — phase 7)
```
id           uuid pk
alert_id     uuid fk alerts null   # linked if it came from a real alert
kind         enum(sos, hazard, verified_incident)
lat / lng    double
radius_m     int
status       enum(active, resolved, unverified)
broadcast_at timestamptz
```

---

## 3. Trigger mechanisms (platform reality)

Hands-free matters because in a real abduction the person can't unlock, open the app, and tap. Here's what each OS actually allows.

**iOS [WATCH]** — third-party apps **cannot** rebind the power button or run always-on hotword detection in the background. Realistic triggers:
- **Back Tap** (Accessibility) → runs a Shortcut → opens/triggers your app. Double/triple tap on the back of the phone.
- **Action Button** (iPhone 15 Pro+) mapped to your Shortcut.
- **Apple Watch companion app** with a prominent button/complication — arguably your best discreet iOS trigger.
- **Siri phrase** ("Hey Siri, I need help") via an App Shortcut.
- **Bluetooth fob** paired as a button (see below).
- In-app **press-and-hold** button as the baseline.

**Android [DECISION]** — much more permissive; this is where hands-free shines:
- **Foreground service** + accessibility service to catch hardware-key patterns (note: Android's own Emergency SOS uses power-button ×5, so pick a non-conflicting pattern like volume up-down-up).
- **Quick Settings tile** for one-swipe access.
- **Always-listening voice phrase** via a foreground service (battery cost — make it opt-in).
- **BLE fob** as above.

**Bluetooth panic fob (both platforms)** — a cheap BLE button (camera-shutter/HID style) paired to the app. Works even with the phone in a pocket/bag, and is the most reliable truly-discreet trigger on iOS. **[DECISION]** Support this early; it sidesteps most iOS limitations.

---

## 4. Alert state machine

```
        ARMED ──trigger──▶ COUNTDOWN ──(no cancel in N s)──▶ TRIGGERED
          ▲                    │                                 │
          │                 cancel(safe_pin)                     ▼
          └────────────────────┘                            ACTIVE ──────▶ VERIFYING
                                                               │  │            │
                                            (owner marks safe) │  │            │(agent confirms)
                                                               ▼  │            ▼
                                                            RESOLVED           DISPATCHED_911
                                                          (safe/false)              │
                                                                                    ▼
                                                                                RESOLVED(responded)
```

- **COUNTDOWN** is the auto-escalation timer (e.g., 10s) — cancelable with the *safe* PIN.
- Entering the **duress/safe** PIN wrong, or entering the **duress** PIN, jumps straight past countdown into a **silent** TRIGGERED (`is_silent=true`).
- **VERIFYING** is the human-in-the-loop / monitoring-agent step before 911.

---

## 5. Fan-out logic

The sequence when an alert fires:

1. **Client** captures a fresh high-accuracy fix (with a timeout — don't block the alert waiting for perfect GPS; send best-available and correct with the next ping). Writes an alert record to a **local outbox** first.
2. **Client → API** `POST /alerts` with an **idempotency key** (so a retry doesn't create duplicate alerts). If the POST fails, the client fires the **SMS fallback directly** via the OS SMS composer / a pre-authorized Twilio path, containing name + `maps.google.com/?q=lat,lng`.
3. **API** persists the alert, reverse-geocodes, resolves the recipient set = all tier-1 guardians.
4. **API fans out** by writing `alert_notifications` rows, then dispatching per channel **in parallel**:
   - Push (FCM/APNs) with a high-priority, time-sensitive payload that deep-links into the live alert view.
   - SMS (Twilio) with the map link — **always**, in parallel with push, not as a fallback-after-timeout. Push silently fails too often to gate SMS on it.
5. **Acknowledgement**: recipient opens → client calls `POST /alerts/:id/ack` → ledger updated → other recipients see "Maria is responding."
6. **Escalation**: if **no** tier-1 ack within T seconds (e.g., 60s), dispatch tier-2 guardians, then trigger the monitoring-center/RapidSOS path.
7. **Live phase**: client streams `location_pings` and `media_segments`; recipients subscribe over WebSocket.
8. **Resolution**: owner marks safe (requires safe PIN) or agent resolves. Hot state flushed to cold storage; media sealed.

**Reliability rules [MUST]:**
- Idempotency keys on alert creation and every retryable call.
- Exponential backoff with jitter on all outbound sends.
- The client outbox survives app restarts; unsent alerts retry on next launch/boot.
- Server-side dedupe: multiple triggers within a short window collapse into one active alert.

---

## 6. Live location streaming

- **Cadence [DECISION]:** adaptive — every 3–5s while moving, back off to 15–30s when stationary, to save battery during a long incident.
- **Transport:** client pushes pings to the API (HTTP/2 or WS); server rebroadcasts to subscribed recipients via Redis pub/sub → WebSocket.
- **Battery:** use platform fused-location with a foreground service (Android) / significant-location + background modes (iOS). Show a persistent notification while active — transparency and OS compliance.
- **Gap detection:** server watches `received_at`; a stalled stream flips the alert UI to "signal lost, last seen HH:MM at <address>" and pins the last-known location — which is itself critical evidence.

---

## 7. Evidence capture

- **[DECISION]** Audio-first for MVP (cheaper, smaller, works screen-locked, less legally fraught than video). Video optional in a later phase.
- Record in **short chunks (5–10s)** and upload each as it completes (resumable/multipart), so evidence is off-device within seconds. Never wait for the recording to "finish."
- Store **write-once**, server-side encrypted, with a per-chunk `sha256` for chain-of-custody.
- **[WATCH — legal]** Audio recording law varies. Many U.S. states are **two-party (all-party) consent** for recording conversations. Recording an attacker without consent may be lawful under one-party rules or personal-safety exceptions, but this is jurisdiction-specific and you must get a lawyer's read before shipping, plus clear user disclosure. Consider a setting that respects the user's state.

---

## 8. Duress & fake-shutdown resistance (honest limits)

**Duress PIN [DECISION]:** two PINs — a *safe* PIN cancels, a *duress* PIN appears to cancel but silently keeps the alert alive (`is_silent=true`, no sound/vibration, decoy "canceled" screen). Wrong-PIN attempts can also silently escalate.

**Fake-shutdown resistance [WATCH]:** be realistic — **no app can prevent a phone from being powered off** (a forced hold-to-power-off always wins, and iOS/Android don't let apps block shutdown). What you *can* do:
- Stream everything continuously so data is already server-side before shutdown.
- Detect the shutdown/low-battery/app-termination signal and fire a **final "going dark" ping** with last location.
- **Relaunch-on-boot** (Android: `BOOT_COMPLETED`; iOS: limited — background app refresh only) so the alert resumes if the phone comes back on.
- Treat a sudden stream cutoff as an **escalation signal**, not a resolution. Silence during an active alert should *raise* urgency.

Market this accurately as "resilient," not "unkillable."

---

## 9. Community layer (Citizen-style) — with guardrails **[MUST read]**

The Citizen model = nearby users get notified of incidents in real time. Adapting it here:

- **Broadcast:** when an alert is verified (or opted in), notify app users within `radius_m` via a PostGIS proximity query, so neighbors can help or stay clear.
- **Mutual-aid framing [DECISION]:** center the feature on *verified incidents and helping the person in danger* — "someone nearby needs help," live-location to willing responders — **not** on "report a suspicious person."
- **[WATCH — this is the moral crux]** A crowdsourced "suspicious activity" feed is exactly the mechanism that produces racial profiling, false accusations, and vigilante escalation. Given this app exists to *protect* Black community members, a poorly designed report feature would put the intended beneficiaries at *greater* risk of being surveilled and reported. So:
  - No open "report a person" flow. Incidents originate from a real SOS or verified sources.
  - No photos/descriptions of individuals in broadcasts.
  - Human moderation + rate limits + abuse reporting before anything goes wide.
  - Consider partnering with community orgs for verification rather than pure crowdsourcing.

---

## 10. RapidSOS / 911 roadmap

You cannot push directly to 911; RapidSOS is the established bridge (covers ECCs reaching 99%+ of the U.S. population; single Emergency API call to connect a device to 911; supports a monitoring-agent verification step). Realistic path:

1. **Book a demo / apply** as an app-and-wearable partner (business track).
2. **Sandbox access** to the Emergency API; build in a test environment first.
3. **Design the call flow:** SOS trigger → your monitoring agent (or RapidSOS Safety Agents) verifies → verified incident + location + name + medical profile pushed to the correct ECC.
4. **Decide monitoring model [DECISION]:** contract a 24/7 UL-listed monitoring center (or RapidSOS Safety Agents) rather than staffing your own initially — human verification is what makes this fly and filters ~90%+ of non-emergencies.
5. **Certification / go-live**, then expand coverage.

**Reality check:** this is a partnership + recurring cost + compliance effort, not a sprint. Ship phases 1–3 (private network, streaming, evidence) and get real users first; the 911 leg is phase 4+ and gates on the monitoring partnership.

---

## 11. Security, privacy, legal — non-negotiables

- **[MUST]** Encrypt in transit (TLS) and at rest; media write-once + hashed for chain-of-custody.
- **[MUST]** Data-retention policy: how long you keep tracks/audio, who can access, deletion on request. Minimize by default.
- **[MUST]** Explicit consent flows: guardians opt in; users consent to location + recording; disclose the community broadcast.
- **[WATCH]** Two-party-consent audio laws (§7), BLE-as-personal-data (§2), and minors (if under-18 users are possible, that's COPPA/parental-consent territory — decide early whether to allow them).
- Threat model the *attacker-has-the-phone* case: server-side data must be recoverable and the account lockable/wipeable remotely.

---

## 12. Build sequence (maps to your phases)

| Phase | Deliverable | Rough effort |
|---|---|---|
| 1 | Core loop: button → location → push+SMS → map deep-link (one test contact) | 2–4 wks |
| 2 | Accounts/OTP, guardian network, double opt-in, ack ledger | 3–5 wks |
| 3 | Live location streaming + chunked audio evidence | 4–6 wks |
| 3.5 | Hands-free triggers (Back Tap/Action Button/Watch, Android keys, BLE fob), duress PIN, countdown | 3–5 wks |
| 4 | RapidSOS + monitoring-center integration (911 leg) | partnership-gated, 2–4 mo |
| 5 | Community/mutual-aid layer with moderation guardrails | 4–8 wks |
| 6 | BLE forensic mode (lawyer-gated) | after legal sign-off |

---

## 13. Top risks to watch

1. **Notification reliability** — push is lossy; SMS-in-parallel is your safety net. Test relentlessly on real devices/networks.
2. **iOS trigger limits** — don't promise power-button magic on iPhone; lean on Watch + fob + Back Tap.
3. **False alarms** — without human verification, you'll erode trust and 911 goodwill fast.
4. **The community layer becoming a profiling tool** — design it as mutual aid, not surveillance (§9).
5. **Legal exposure** on recording + BLE — get counsel before those features ship.

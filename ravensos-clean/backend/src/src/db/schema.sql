-- Production schema (Postgres 15+ with PostGIS). The in-memory store mirrors this.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  display_name    text NOT NULL,
  phone           text UNIQUE NOT NULL,
  email           text,
  photo_url       text,
  medical_notes   text,
  duress_pin_hash text,
  safe_pin_hash   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE guardians (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guardian_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  name          text NOT NULL,
  phone         text NOT NULL,
  channel_pref  text NOT NULL DEFAULT 'both' CHECK (channel_pref IN ('push','sms','both')),
  priority_tier smallint NOT NULL DEFAULT 1,
  relationship  text,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_guardians_owner ON guardians(owner_id, priority_tier);

CREATE TABLE alerts (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id             uuid NOT NULL REFERENCES users(id),
  status               text NOT NULL,
  trigger_type         text NOT NULL,
  triggered_at         timestamptz NOT NULL DEFAULT now(),
  origin_lat           double precision NOT NULL,
  origin_lng           double precision NOT NULL,
  origin_accuracy_m    real,
  origin_address       text,
  origin_geom          geography(Point, 4326),
  is_silent            boolean NOT NULL DEFAULT false,
  verified_by          text NOT NULL DEFAULT 'none' CHECK (verified_by IN ('none','self','agent')),
  dispatched_911       boolean NOT NULL DEFAULT false,
  rapidsos_incident_id text,
  resolved_at          timestamptz,
  resolution           text CHECK (resolution IN ('safe','false_alarm','responded','unknown'))
);
CREATE INDEX idx_alerts_owner ON alerts(owner_id, triggered_at DESC);
CREATE INDEX idx_alerts_geom ON alerts USING gist(origin_geom);

CREATE TABLE location_pings (
  id          bigserial PRIMARY KEY,
  alert_id    uuid NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  accuracy_m  real,
  speed_mps   real,
  heading_deg real,
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pings_alert ON location_pings(alert_id, recorded_at);

CREATE TABLE media_segments (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_id    uuid NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('audio','video')),
  seq         int NOT NULL,
  s3_key      text NOT NULL,
  duration_ms int,
  sha256      text,
  started_at  timestamptz NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alert_notifications (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_id        uuid NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  recipient_id    uuid NOT NULL REFERENCES guardians(id),
  channel         text NOT NULL CHECK (channel IN ('push','sms','voice')),
  status          text NOT NULL DEFAULT 'queued',
  provider_ref    text,
  sent_at         timestamptz,
  acknowledged_at timestamptz
);
CREATE INDEX idx_notif_alert ON alert_notifications(alert_id);

-- Idempotency for alert creation (retries must not create duplicates).
CREATE TABLE idempotency_keys (
  key        text PRIMARY KEY,
  alert_id   uuid NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

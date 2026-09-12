-- Trạm 1: hòm thư đến
CREATE TABLE raw_events (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  attempts        INT  NOT NULL DEFAULT 0,
  last_error      TEXT,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ
);
CREATE INDEX idx_raw_events_pending ON raw_events (status, id) WHERE status = 'pending';

-- Trạm 2: sổ hiện trạng
CREATE TABLE products_current (
  product_id   TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  payload      JSONB NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trạm 3: nhật ký thay đổi
CREATE TABLE product_changes (
  id           BIGSERIAL PRIMARY KEY,
  product_id   TEXT NOT NULL,
  change_type  TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  payload      JSONB NOT NULL,
  source       TEXT NOT NULL,
  detected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_product_change UNIQUE (product_id, content_hash)
);

-- Bảng phụ
CREATE TABLE ingestion_cursor (
  source       TEXT PRIMARY KEY,
  cursor_value TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

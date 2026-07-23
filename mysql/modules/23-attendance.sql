-- ============================================================
-- HG Ops — worker self-clock attendance
-- ja_clock_events = immutable evidence (selfie + SERVER time + GPS + face verdict)
-- Roll-up target stays ja_attendance_log (the wage engine's table — untouched).
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS ja_clock_events (
  id           BIGINT AUTO_INCREMENT,
  worker_id    VARCHAR(64)  NOT NULL,
  worker_name  VARCHAR(255) DEFAULT '',
  op_date      DATE NOT NULL,                 -- operational KL date the punch belongs to
  category     VARCHAR(8)  DEFAULT 'day',     -- day | night
  kind         VARCHAR(4)  NOT NULL,          -- in | out
  ts           DATETIME NOT NULL,             -- SERVER KL time (never the phone's clock)
  selfie_url   VARCHAR(512) DEFAULT '',
  gps_lat      DECIMAL(10,6) NULL,
  gps_lng      DECIMAL(10,6) NULL,
  gps_acc      INT NULL,                      -- metres
  face_verdict VARCHAR(12) DEFAULT 'pending', -- pending | match | mismatch | unclear | approved | voided
  face_notes   VARCHAR(512) DEFAULT '',
  device_info  VARCHAR(255) DEFAULT '',
  via_token    VARCHAR(64)  DEFAULT '',
  reviewed_by  VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id),
  INDEX idx_jce_date (op_date),
  INDEX idx_jce_worker (worker_id, op_date),
  INDEX idx_jce_verdict (face_verdict)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- permanent per-worker clock link (rotatable; WhatsApp'd once / printed as QR)
CREATE TABLE IF NOT EXISTS ja_clock_tokens (
  token      VARCHAR(64) NOT NULL,
  worker_id  VARCHAR(64) NOT NULL,
  active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(255) DEFAULT '',
  PRIMARY KEY (token),
  INDEX idx_jct_worker (worker_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- HG hub — ONE DATA BACKBONE: canonical master tables (MySQL 8 / MariaDB)
-- One row per real-world client / worker / vehicle / mall.
-- Old per-module master tables stay untouched (history + rollback);
-- hg_master_map links every old row to its canonical record.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS hg_clients (
  id             CHAR(36) NOT NULL DEFAULT (uuid()),
  name           VARCHAR(255) NOT NULL,
  name_norm      VARCHAR(255) NOT NULL,               -- normalized for dedupe/lookup
  type           VARCHAR(64)  DEFAULT 'Contractor',   -- Mall / Contractor / Tenant
  contact_person VARCHAR(255) DEFAULT '',
  phone          VARCHAR(64)  DEFAULT '',
  email          VARCHAR(255) DEFAULT '',
  address        TEXT,
  reg_no         VARCHAR(64)  DEFAULT '',
  b2b_exempt     TINYINT(1)   DEFAULT 0,
  notes          TEXT,
  status         ENUM('active','pending','merged','rejected') NOT NULL DEFAULT 'active',
  merged_into    CHAR(36) NULL,
  created_by     VARCHAR(255) DEFAULT '',
  approved_by    VARCHAR(255) DEFAULT '',
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_hgc_norm (name_norm),
  INDEX idx_hgc_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hg_workers (
  id             CHAR(36) NOT NULL DEFAULT (uuid()),
  full_name      VARCHAR(255) NOT NULL,
  name_norm      VARCHAR(255) NOT NULL,
  ic_number      VARCHAR(64)  DEFAULT '',
  passport_number VARCHAR(64) DEFAULT '',
  nationality    VARCHAR(64)  DEFAULT '',
  division       VARCHAR(128) DEFAULT '',
  position       VARCHAR(128) DEFAULT '',
  phone          VARCHAR(64)  DEFAULT '',
  photo_url      VARCHAR(512) DEFAULT '',
  worker_status  VARCHAR(32)  DEFAULT 'Active',       -- roster status (Active/Resigned/…)
  -- wage profile (from ja_workers) — SENSITIVE: admin-only at API layer
  team           VARCHAR(64)  DEFAULT '',
  rate           DECIMAL(14,2) NULL,
  monthly_pay    DECIMAL(14,2) NULL,
  bank_name      VARCHAR(255) DEFAULT '',
  account_name   VARCHAR(255) DEFAULT '',
  account_no     VARCHAR(64)  DEFAULT '',
  notes          TEXT,
  status         ENUM('active','pending','merged','rejected') NOT NULL DEFAULT 'active',
  merged_into    CHAR(36) NULL,
  created_by     VARCHAR(255) DEFAULT '',
  approved_by    VARCHAR(255) DEFAULT '',
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_hgw_norm (name_norm),
  INDEX idx_hgw_ic (ic_number),
  INDEX idx_hgw_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hg_vehicles (
  id             CHAR(36) NOT NULL DEFAULT (uuid()),
  plate          VARCHAR(32)  NOT NULL,
  plate_norm     VARCHAR(32)  NOT NULL,               -- uppercased, no spaces
  code           VARCHAR(32)  DEFAULT '',             -- internal code e.g. ST11
  vtype          VARCHAR(64)  DEFAULT '',             -- Lorry 1T / 3T / Van / …
  make           VARCHAR(64)  DEFAULT '',
  model          VARCHAR(64)  DEFAULT '',
  year           VARCHAR(8)   DEFAULT '',
  capacity       VARCHAR(64)  DEFAULT '',
  vehicle_status VARCHAR(32)  DEFAULT 'Active',       -- Active / Retired / Sold
  notes          TEXT,
  status         ENUM('active','pending','merged','rejected') NOT NULL DEFAULT 'active',
  merged_into    CHAR(36) NULL,
  created_by     VARCHAR(255) DEFAULT '',
  approved_by    VARCHAR(255) DEFAULT '',
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_hgv_plate (plate_norm),
  INDEX idx_hgv_code (code),
  INDEX idx_hgv_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hg_malls (
  id             CHAR(36) NOT NULL DEFAULT (uuid()),
  name           VARCHAR(255) NOT NULL,
  name_norm      VARCHAR(255) NOT NULL,
  code           VARCHAR(32)  DEFAULT '',
  state          VARCHAR(64)  DEFAULT '',             -- KL / Selangor / Johor / … (drives job-arr wage rates)
  location       VARCHAR(255) DEFAULT '',
  notes          TEXT,
  status         ENUM('active','pending','merged','rejected') NOT NULL DEFAULT 'active',
  merged_into    CHAR(36) NULL,
  created_by     VARCHAR(255) DEFAULT '',
  approved_by    VARCHAR(255) DEFAULT '',
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_hgm_norm (name_norm),
  INDEX idx_hgm_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- every source row (old module tables) → its canonical record
CREATE TABLE IF NOT EXISTS hg_master_map (
  id            BIGINT AUTO_INCREMENT,
  entity_type   VARCHAR(16)  NOT NULL,   -- client | worker | vehicle | mall
  source_table  VARCHAR(64)  NOT NULL,
  source_id     VARCHAR(128) NOT NULL,   -- old row id (or the raw NAME for name-only lists like ja_lookups)
  source_name   VARCHAR(512) DEFAULT '', -- raw text as it appeared in the source
  canonical_id  CHAR(36)     NOT NULL,
  method        VARCHAR(16)  DEFAULT 'exact',  -- exact | fuzzy-approved | manual | delta
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_map (entity_type, source_table, source_id),
  INDEX idx_map_canon (canonical_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

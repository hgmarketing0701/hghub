-- ============================================================
-- HG hub — Dispatch Command: lanes (lorries + factory) per shift per date
-- A "lane" is a workplace: a real lorry (ja_lorries id) or a sentinel
-- 'FACTORY' / 'NO_LORRY'. One row per lane per shift section per date.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS ja_dispatch_loads (
  id            BIGINT AUTO_INCREMENT,
  dispatch_date DATE NOT NULL,
  shift_group   VARCHAR(8)  NOT NULL,           -- 'day' | 'night'
  lorry_id      VARCHAR(64) NOT NULL,           -- ja_lorries.id | 'FACTORY' | 'NO_LORRY'
  driver_id     VARCHAR(64)  DEFAULT '',        -- ja_supervisors.id ('' for sentinels)
  driver_name   VARCHAR(255) DEFAULT '',
  worker_ids    JSON NULL,                      -- ja_workers ids riding/working this lane
  notes         TEXT,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by    VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY uq_lane (dispatch_date, shift_group, lorry_id),
  INDEX idx_jdl_date (dispatch_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ja_lorries: remember each lorry's usual driver (changeable per shift in the UI)
SET @s := (SELECT IF(COUNT(*)=0,
  'ALTER TABLE ja_lorries ADD COLUMN usual_driver_id VARCHAR(64) DEFAULT ''''',
  'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='ja_lorries' AND column_name='usual_driver_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*)=0,
  'ALTER TABLE ja_lorries ADD COLUMN usual_driver_name VARCHAR(255) DEFAULT ''''',
  'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='ja_lorries' AND column_name='usual_driver_name');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ja_job_readiness: which lane carries this job (team_no kept as legacy, no longer used)
SET @s := (SELECT IF(COUNT(*)=0,
  'ALTER TABLE ja_job_readiness ADD COLUMN lorry_id VARCHAR(64) DEFAULT ''''',
  'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='ja_job_readiness' AND column_name='lorry_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

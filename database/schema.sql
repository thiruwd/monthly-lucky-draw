-- This file targets the database selected by the migration runner.
-- All DATETIME values are UTC. Calendar eligibility uses APP_TIMEZONE.
CREATE TABLE IF NOT EXISTS draw_lock (
  id TINYINT UNSIGNED PRIMARY KEY
) ENGINE=InnoDB;
INSERT IGNORE INTO draw_lock (id) VALUES (1);

CREATE TABLE IF NOT EXISTS members (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  member_code VARCHAR(50) NULL,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(255) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  UNIQUE KEY uq_members_code (member_code),
  KEY idx_members_eligibility (deleted_at, is_active, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lucky_draw_winners (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  member_id BIGINT UNSIGNED NOT NULL,
  member_name VARCHAR(150) NOT NULL,
  draw_month TINYINT UNSIGNED NOT NULL,
  draw_year SMALLINT UNSIGNED NOT NULL,
  won_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_winners_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT,
  CONSTRAINT chk_draw_month CHECK (draw_month BETWEEN 1 AND 12),
  UNIQUE KEY uq_member_month (member_id, draw_month, draw_year),
  KEY idx_winners_period (draw_year, draw_month, won_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admins (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(80) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_admin_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  admin_id BIGINT UNSIGNED NOT NULL,
  csrf_token CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_session_admin FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
  KEY idx_sessions_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS draw_requests (
  admin_id BIGINT UNSIGNED NOT NULL,
  request_key VARCHAR(64) NOT NULL,
  response_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (admin_id, request_key),
  CONSTRAINT fk_request_admin FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

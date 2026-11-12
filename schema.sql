-- Skema database coin-game (MariaDB / MySQL)

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  google_sub    VARCHAR(64)  NOT NULL,
  email         VARCHAR(255) NOT NULL,
  name          VARCHAR(150) NULL,
  avatar        VARCHAR(500) NULL,
  coin_balance  BIGINT       NOT NULL DEFAULT 0,
  referral_code VARCHAR(12)  NULL,
  referred_by   BIGINT UNSIGNED NULL,
  role          ENUM('player','admin') NOT NULL DEFAULT 'player',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_google_sub (google_sub),
  UNIQUE KEY uq_users_referral_code (referral_code),
  KEY idx_users_email (email),
  KEY idx_users_referred_by (referred_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS coin_ledger (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  amount        BIGINT       NOT NULL,
  balance_after BIGINT       NOT NULL,
  type          ENUM('gameplay','mission','ad','wheel','referral','withdraw','adjust') NOT NULL,
  ref           VARCHAR(100) NULL,
  note          VARCHAR(255) NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ledger_user_time (user_id, created_at),
  CONSTRAINT fk_ledger_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  jti         CHAR(36)     NOT NULL,
  ip          VARCHAR(64)  NULL,
  user_agent  VARCHAR(255) NULL,
  last_seen   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_jti (jti),
  KEY idx_sessions_last_seen (last_seen),
  KEY idx_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS game_stats (
  user_id     BIGINT UNSIGNED NOT NULL,
  stat_day    DATE         NOT NULL,
  rounds      INT UNSIGNED NOT NULL DEFAULT 0,
  earned_coins BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, stat_day),
  CONSTRAINT fk_stats_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS game_rounds (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  seed         BIGINT UNSIGNED NOT NULL,
  duration_ms  INT UNSIGNED NOT NULL,
  max_catch    INT UNSIGNED NOT NULL,
  caught       INT UNSIGNED NULL,
  reward_coin  BIGINT UNSIGNED NULL,
  started_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at  DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_rounds_user_day (user_id, started_at),
  CONSTRAINT fk_rounds_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wheel_spins (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  spin_day    DATE NOT NULL,
  prize_index TINYINT UNSIGNED NOT NULL,
  reward_coin BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_wheel_user_day (user_id, spin_day),
  CONSTRAINT fk_wheel_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ad_tokens (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  token         CHAR(36) NOT NULL,
  purpose       VARCHAR(20) NOT NULL,
  watch_seconds INT UNSIGNED NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at       DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ad_token (token),
  KEY idx_ad_user (user_id),
  CONSTRAINT fk_ad_token_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS referrals (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  referrer_id      BIGINT UNSIGNED NOT NULL,
  invitee_id       BIGINT UNSIGNED NOT NULL,
  reward_referrer  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  reward_invitee   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_referral_invitee (invitee_id),
  KEY idx_referral_referrer (referrer_id),
  CONSTRAINT fk_ref_referrer FOREIGN KEY (referrer_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_ref_invitee FOREIGN KEY (invitee_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_bonuses (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  code        VARCHAR(50) NOT NULL,
  reward_coin BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bonus_user_code (user_id, code),
  CONSTRAINT fk_bonus_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS missions (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(50)  NOT NULL,
  title       VARCHAR(120) NOT NULL,
  description VARCHAR(255) NULL,
  type        ENUM('daily_login','rounds') NOT NULL,
  target      INT UNSIGNED NOT NULL DEFAULT 1,
  reward_coin BIGINT UNSIGNED NOT NULL,
  daily_limit TINYINT UNSIGNED NOT NULL DEFAULT 1,
  active      TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_missions_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mission_claims (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  mission_code VARCHAR(50)  NOT NULL,
  claim_day    DATE         NOT NULL,
  reward_coin  BIGINT UNSIGNED NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_claim_user_mission_day (user_id, mission_code, claim_day),
  CONSTRAINT fk_claim_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS withdrawals (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        BIGINT UNSIGNED NOT NULL,
  amount_idr     INT UNSIGNED NOT NULL,
  coin_amount    BIGINT UNSIGNED NOT NULL,
  method         ENUM('ewallet','bank') NOT NULL,
  provider       VARCHAR(50)  NOT NULL,
  account_name   VARCHAR(120) NOT NULL,
  account_number VARCHAR(50)  NOT NULL,
  status         ENUM('pending','processing','paid','rejected') NOT NULL DEFAULT 'pending',
  note           VARCHAR(255) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_wd_user (user_id),
  KEY idx_wd_status (status),
  CONSTRAINT fk_wd_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO missions (code, title, description, type, target, reward_coin, daily_limit, active)
VALUES
  ('daily_login', 'Login Harian', 'Masuk setiap hari untuk bonus coin', 'daily_login', 1, 500, 1, 1),
  ('play_3_rounds', 'Pemanasan', 'Mainkan 3 ronde Coin Rush hari ini', 'rounds', 3, 1000, 1, 1)
ON DUPLICATE KEY UPDATE title = VALUES(title);

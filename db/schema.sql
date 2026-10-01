-- BarShift Hub: ei sisällä baarien omaa dataa, vain julkaistut tapahtumat/vuorot ja keikkatyöntekijöiden omat profiilit
CREATE TABLE IF NOT EXISTS `pubs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(64) NOT NULL,
  `name` varchar(120) NOT NULL,
  `city` varchar(80) NOT NULL DEFAULT '',
  `public_key` varchar(64) NOT NULL COMMENT 'Ed25519, base64',
  `status` enum('active','suspended') NOT NULL DEFAULT 'active',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`), UNIQUE KEY `uq_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `nonces` (
  `pub_id` int NOT NULL, `nonce` varchar(64) NOT NULL, `ts` int NOT NULL,
  PRIMARY KEY (`pub_id`,`nonce`), KEY `idx_ts` (`ts`)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

CREATE TABLE IF NOT EXISTS `events` (
  `id` int NOT NULL AUTO_INCREMENT,
  `pub_id` int NOT NULL, `external_id` varchar(64) NOT NULL,
  `title` varchar(160) NOT NULL, `description` varchar(1000) DEFAULT NULL,
  `date` date NOT NULL, `time_start` time DEFAULT NULL, `time_end` time DEFAULT NULL,
  `type` varchar(40) DEFAULT NULL, `price_text` varchar(60) DEFAULT NULL, `url` varchar(300) DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`), UNIQUE KEY `uq_ext` (`pub_id`,`external_id`), KEY `idx_date` (`date`),
  CONSTRAINT `fk_ev_pub` FOREIGN KEY (`pub_id`) REFERENCES `pubs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `shifts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `pub_id` int NOT NULL, `external_id` varchar(64) NOT NULL,
  `date` date NOT NULL, `time_start` time NOT NULL, `time_end` time NOT NULL,
  `role` varchar(60) DEFAULT NULL, `pay_text` varchar(80) DEFAULT NULL, `note` varchar(300) DEFAULT NULL,
  `status` enum('open','filled','cancelled') NOT NULL DEFAULT 'open',
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`), UNIQUE KEY `uq_ext` (`pub_id`,`external_id`), KEY `idx_date` (`date`),
  CONSTRAINT `fk_sh_pub` FOREIGN KEY (`pub_id`) REFERENCES `pubs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `workers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(190) NOT NULL, `name` varchar(120) NOT NULL, `phone` varchar(40) DEFAULT NULL,
  `city` varchar(80) NOT NULL DEFAULT '', `skills` varchar(300) NOT NULL DEFAULT '',
  `password_hash` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`), UNIQUE KEY `uq_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sessions` (
  `token_hash` char(64) NOT NULL, `worker_id` int NOT NULL, `expires_at` datetime NOT NULL,
  PRIMARY KEY (`token_hash`), KEY `idx_w` (`worker_id`),
  CONSTRAINT `fk_se_w` FOREIGN KEY (`worker_id`) REFERENCES `workers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

CREATE TABLE IF NOT EXISTS `applications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `shift_id` int NOT NULL, `worker_id` int NOT NULL, `message` varchar(500) DEFAULT NULL,
  `status` enum('pending','accepted','declined','withdrawn') NOT NULL DEFAULT 'pending',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(), `decided_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`), UNIQUE KEY `uq_app` (`shift_id`,`worker_id`),
  CONSTRAINT `fk_ap_s` FOREIGN KEY (`shift_id`) REFERENCES `shifts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ap_w` FOREIGN KEY (`worker_id`) REFERENCES `workers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `rate_limits` (
  `k` varchar(120) NOT NULL, `ts` int NOT NULL, KEY `idx_k` (`k`,`ts`)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

ALTER TABLE `pubs` ADD COLUMN IF NOT EXISTS `last_seen_at` datetime DEFAULT NULL;

CREATE TABLE IF NOT EXISTS `admins` (
  `id` int NOT NULL AUTO_INCREMENT, `username` varchar(60) NOT NULL, `password_hash` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`), UNIQUE KEY `uq_user` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `settings` (
  `k` varchar(60) NOT NULL, `v` varchar(500) NOT NULL DEFAULT '', PRIMARY KEY (`k`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `pubs` MODIFY `status` enum('active','suspended','pending') NOT NULL DEFAULT 'active';
ALTER TABLE `pubs` MODIFY `public_key` varchar(64) NOT NULL DEFAULT '';
ALTER TABLE `pubs` ADD COLUMN IF NOT EXISTS `pair_hash` char(64) DEFAULT NULL;
ALTER TABLE `pubs` ADD COLUMN IF NOT EXISTS `pair_expires` datetime DEFAULT NULL;

ALTER TABLE `pubs` ADD COLUMN IF NOT EXISTS `address` varchar(200) DEFAULT NULL;
ALTER TABLE `pubs` ADD COLUMN IF NOT EXISTS `lat` decimal(9,6) DEFAULT NULL;
ALTER TABLE `pubs` ADD COLUMN IF NOT EXISTS `lng` decimal(9,6) DEFAULT NULL;
ALTER TABLE `pubs` ADD COLUMN IF NOT EXISTS `website` varchar(300) DEFAULT NULL;

-- Baarien väliset keikkahakemukset: toisen baarin työntekijä hakee vuoroa oman baarinsa kautta.
-- Hakijan tiedot kulkevat vain tämän hakemuksen vastaanottavalle baarille, keskus ei pidä niitä muuhun käyttöön.
ALTER TABLE `applications` MODIFY `worker_id` int DEFAULT NULL;
ALTER TABLE `applications` ADD COLUMN IF NOT EXISTS `from_pub_id` int DEFAULT NULL;
ALTER TABLE `applications` ADD COLUMN IF NOT EXISTS `applicant_ref` varchar(64) DEFAULT NULL;
ALTER TABLE `applications` ADD COLUMN IF NOT EXISTS `applicant_name` varchar(120) DEFAULT NULL;
ALTER TABLE `applications` ADD COLUMN IF NOT EXISTS `applicant_phone` varchar(40) DEFAULT NULL;
ALTER TABLE `applications` ADD COLUMN IF NOT EXISTS `applicant_email` varchar(190) DEFAULT NULL;
ALTER TABLE `applications` ADD COLUMN IF NOT EXISTS `applicant_skills` varchar(300) DEFAULT NULL;
ALTER TABLE `applications` ADD UNIQUE KEY IF NOT EXISTS `uq_pub_app` (`shift_id`,`from_pub_id`,`applicant_ref`);
ALTER TABLE `applications` ADD FOREIGN KEY IF NOT EXISTS `fk_ap_pub` (`from_pub_id`) REFERENCES `pubs` (`id`) ON DELETE CASCADE;

-- Julkisen kalenterin käyttötilastot (ei henkilötietoja)
CREATE TABLE IF NOT EXISTS `stat_daily` (
  `day` date NOT NULL, `views` int NOT NULL DEFAULT 0, `uniques` int NOT NULL DEFAULT 0, `opens` int NOT NULL DEFAULT 0, `links` int NOT NULL DEFAULT 0, `ics` int NOT NULL DEFAULT 0,
  PRIMARY KEY (`day`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `stat_event` (
  `event_id` int NOT NULL, `opens` int NOT NULL DEFAULT 0, `links` int NOT NULL DEFAULT 0, `ics` int NOT NULL DEFAULT 0, `last_at` datetime DEFAULT NULL,
  PRIMARY KEY (`event_id`), CONSTRAINT `fk_st_ev` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `stat_seen` (
  `day` date NOT NULL, `h` char(16) NOT NULL, PRIMARY KEY (`day`,`h`)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

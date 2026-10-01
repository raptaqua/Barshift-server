<?php
// Cron (päivittäin): siivoaa vanhat vuorot, tapahtumat, nonce- ja rate limit -rivit sekä vanhentuneet istunnot
require __DIR__ . '/../lib/core.php';
if (PHP_SAPI !== 'cli') exit(1);
q("DELETE FROM events WHERE date < CURDATE() - INTERVAL 7 DAY");
q("DELETE FROM shifts WHERE date < CURDATE() - INTERVAL 30 DAY");
q("DELETE FROM nonces WHERE ts < ?", 'i', [time() - 3600]);
q("DELETE FROM rate_limits WHERE ts < ?", 'i', [time() - 86400]);
q("DELETE FROM sessions WHERE expires_at < NOW()");
echo "OK\n";

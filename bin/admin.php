<?php
// php bin/admin.php create <tunnus>  – luo hallintatunnuksen tai vaihtaa salasanan (salasana kysytään)
require __DIR__ . '/../lib/core.php';
if (PHP_SAPI !== 'cli') exit(1);
if (($argv[1] ?? '') !== 'create' || !preg_match('/^[a-z0-9._-]{3,60}$/', strtolower($argv[2] ?? ''))) { fwrite(STDERR, "Käyttö: php bin/admin.php create <tunnus>\n"); exit(1); }
echo "Salasana (väh. 12 merkkiä): ";
system('stty -echo 2>/dev/null'); $pw = rtrim((string)fgets(STDIN), "\r\n"); system('stty echo 2>/dev/null'); echo "\n";
if (strlen($pw) < 12) { fwrite(STDERR, "Salasana on liian lyhyt\n"); exit(1); }
q("INSERT INTO admins (username, password_hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)", 'ss', [strtolower($argv[2]), password_hash($pw, PASSWORD_DEFAULT)]);
echo "Valmis. Kirjaudu osoitteessa /admin\n";

<?php
// php bin/add_pub.php <slug> "<nimi>" "<kaupunki>" <public_key_base64>   |  --suspend <slug>  |  --activate <slug>
require __DIR__ . '/../lib/core.php';
if (PHP_SAPI !== 'cli') exit(1);
$a = array_slice($argv, 1);
if (in_array($a[0] ?? '', ['--suspend', '--activate'], true) && isset($a[1])) {
    q("UPDATE pubs SET status = ? WHERE slug = ?", 'ss', [$a[0] === '--suspend' ? 'suspended' : 'active', $a[1]]);
    echo "OK\n"; exit;
}
if (count($a) !== 4 || !preg_match('/^[a-z0-9_-]{1,64}$/', $a[0])) { fwrite(STDERR, "Käyttö: add_pub.php <slug> <nimi> <kaupunki> <public_key>\n"); exit(1); }
$pk = base64_decode($a[3], true);
if ($pk === false || strlen($pk) !== SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES) { fwrite(STDERR, "Virheellinen julkinen avain\n"); exit(1); }
q("INSERT INTO pubs (slug, name, city, public_key) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE name = VALUES(name), city = VALUES(city), public_key = VALUES(public_key)", 'ssss', $a);
echo "Baari {$a[0]} rekisteröity\n";

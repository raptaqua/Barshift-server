<?php
// php bin/install.php : luo taulut (idempotentti)
require __DIR__ . '/../lib/core.php';
if (PHP_SAPI !== 'cli') exit(1);
foreach (array_filter(array_map('trim', explode(';', file_get_contents(__DIR__ . '/../db/schema.sql')))) as $sql) {
    if (!db()->query($sql)) { fwrite(STDERR, db()->error . "\n"); exit(1); }
}
echo "Taulut valmiina\n";

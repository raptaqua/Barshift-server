#!/usr/bin/env bash
# Integraatiotestit: luo tyhjän testikannan, käynnistää PHP-palvelimen ja ajaa tests/api.test.js
set -euo pipefail
cd "$(dirname "$0")/.."
DB_HOST="${TEST_DB_HOST:-localhost}"; DB_NAME="${TEST_DB_NAME:-barshift_hub_test}"; DB_USER="${TEST_DB_USER:-root}"; DB_PASS="${TEST_DB_PASS:-}"
PORT="${TEST_PORT:-8499}"; TMP="$(mktemp -d)"; trap '[ -n "${PHP_PID:-}" ] && kill $PHP_PID 2>/dev/null; [ -n "${PHP2_PID:-}" ] && kill $PHP2_PID 2>/dev/null; rm -rf "$TMP"' EXIT
MYSQL=(mysql -h "$DB_HOST" -u "$DB_USER" ${DB_PASS:+-p"$DB_PASS"})
"${MYSQL[@]}" -e "DROP DATABASE IF EXISTS \`$DB_NAME\`; CREATE DATABASE \`$DB_NAME\` CHARACTER SET utf8mb4;"
cat > "$TMP/config.php" <<PHP
<?php return ['db_host'=>'$DB_HOST','db_name'=>'$DB_NAME','db_user'=>'$DB_USER','db_pass'=>'$DB_PASS','allowed_origins'=>[]];
PHP
export HUB_CONFIG="$TMP/config.php"
php bin/install.php
php -S 127.0.0.1:$PORT -t public public/index.php > "$TMP/php.log" 2>&1 & PHP_PID=$!
# toinen palvelin alihakemistoasennuksen testaamiseen (base_path /hub)
cat > "$TMP/config_sub.php" <<PHP
<?php return ['db_host'=>'$DB_HOST','db_name'=>'$DB_NAME','db_user'=>'$DB_USER','db_pass'=>'$DB_PASS','allowed_origins'=>[],'base_path'=>'/hub'];
PHP
HUB_CONFIG="$TMP/config_sub.php" php -S 127.0.0.1:$((PORT+1)) -t public public/index.php > "$TMP/php2.log" 2>&1 & PHP2_PID=$!
sleep 1
HUB_BASE="http://127.0.0.1:$PORT" HUB_SUB="http://127.0.0.1:$((PORT+1))" HUB_CONFIG="$HUB_CONFIG" node tests/api.test.js || { tail -20 "$TMP/php.log"; exit 1; }

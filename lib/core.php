<?php
declare(strict_types=1);
mysqli_report(MYSQLI_REPORT_OFF);

function cfg(): array { static $c; return $c ??= require getenv('HUB_CONFIG') ?: __DIR__ . '/../config.php'; }
function db(): mysqli {
    static $c;
    if ($c) return $c;
    $k = cfg();
    $c = @new mysqli($k['db_host'], $k['db_user'], $k['db_pass'], $k['db_name']);
    if ($c->connect_errno) fail('Tietokantavirhe', 500);
    $c->set_charset('utf8mb4');
    return $c;
}
function fail(string $msg, int $code = 400): never { out(['error' => $msg], $code); }
function out($data, int $code = 200): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function q(string $sql, string $types = '', array $args = []): mysqli_stmt {
    $st = db()->prepare($sql);
    if (!$st) fail('Tietokantavirhe', 500);
    if ($types !== '') $st->bind_param($types, ...$args);
    if (!$st->execute()) fail('Tietokantavirhe', 500);
    return $st;
}
function rows(mysqli_stmt $st): array { return $st->get_result()->fetch_all(MYSQLI_ASSOC); }
function one(mysqli_stmt $st): ?array { return $st->get_result()->fetch_assoc() ?: null; }

function body(): array {
    $raw = rawBody();
    if ($raw === '') return [];
    $d = json_decode($raw, true);
    if (!is_array($d)) fail('Virheellinen JSON');
    return $d;
}
function rawBody(): string { static $r; return $r ??= (string)file_get_contents('php://input', false, null, 0, 65537); }

// Kenttävalidointi
function str($v, int $max, string $name, bool $required = false): ?string {
    if ($v === null || $v === '') { if ($required) fail("Pakollinen: $name"); return null; }
    if (!is_string($v)) fail("Virheellinen: $name");
    $v = trim($v);
    if (mb_strlen($v) > $max) fail("Liian pitkä: $name");
    if (preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $v)) fail("Virheellinen: $name");
    if ($required && $v === '') fail("Pakollinen: $name");
    return $v === '' ? null : $v;
}
function dateStr($v, string $name): string {
    if (!is_string($v) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) || !checkdate((int)substr($v, 5, 2), (int)substr($v, 8, 2), (int)substr($v, 0, 4))) fail("Virheellinen päivä: $name");
    return $v;
}
function timeStr($v, string $name, bool $required): ?string {
    if ($v === null || $v === '') { if ($required) fail("Pakollinen: $name"); return null; }
    if (!is_string($v) || !preg_match('/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/', $v)) fail("Virheellinen aika: $name");
    return strlen($v) === 5 ? $v . ':00' : $v;
}
function safeUrl($v): ?string {
    $v = str($v, 300, 'url');
    if ($v === null) return null;
    if (!preg_match('#^https?://[^\s<>"]+$#i', $v)) fail('Virheellinen url');
    return $v;
}

function rateLimit(string $key, int $max, int $windowSec = 900): void {
    $now = time();
    q("DELETE FROM rate_limits WHERE ts < ?", 'i', [$now - 86400]);
    $n = (int)one(q("SELECT COUNT(*) c FROM rate_limits WHERE k = ? AND ts > ?", 'si', [$key, $now - $windowSec]))['c'];
    if ($n >= $max) fail('Liian monta yritystä. Yritä myöhemmin uudelleen.', 429);
    q("INSERT INTO rate_limits (k, ts) VALUES (?, ?)", 'si', [$key, $now]);
}

<?php
declare(strict_types=1);
require __DIR__ . '/../lib/core.php';
require __DIR__ . '/../lib/auth.php';

set_exception_handler(function (Throwable $e) { error_log((string)$e); fail('Palvelinvirhe', 500); });
header('X-Content-Type-Options: nosniff'); header('Referrer-Policy: no-referrer');

$method = $_SERVER['REQUEST_METHOD'];
$path = rtrim((string)parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/') ?: '/';

// CORS: julkinen kalenteri kaikille, muut vain sallituille origineille
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($path === '/public/events') header('Access-Control-Allow-Origin: *');
elseif ($origin !== '' && in_array($origin, cfg()['allowed_origins'] ?? [], true)) { header("Access-Control-Allow-Origin: $origin"); header('Vary: Origin'); }
if ($method === 'OPTIONS') { header('Access-Control-Allow-Headers: Authorization, Content-Type'); header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE'); http_response_code(204); exit; }

$extId = '/^[A-Za-z0-9_.-]{1,64}$/';
$m = [];

// ---------- Julkinen ----------
if ($method === 'GET' && $path === '/public/events') {
    $from = isset($_GET['from']) ? dateStr($_GET['from'], 'from') : date('Y-m-d');
    $to = isset($_GET['to']) ? dateStr($_GET['to'], 'to') : date('Y-m-d', strtotime('+180 days'));
    $limit = max(1, min(200, (int)($_GET['limit'] ?? 100)));
    $city = isset($_GET['city']) ? (string)$_GET['city'] : '';
    $sql = "SELECT e.title, e.description, e.date, e.time_start, e.time_end, e.type, e.price_text, e.url, p.name AS pub, p.city
            FROM events e JOIN pubs p ON p.id = e.pub_id WHERE p.status = 'active' AND e.date BETWEEN ? AND ?";
    $types = 'ss'; $args = [$from, $to];
    if ($city !== '') { $sql .= " AND p.city = ?"; $types .= 's'; $args[] = $city; }
    $sql .= " ORDER BY e.date, e.time_start LIMIT $limit";
    out(['events' => rows(q($sql, $types, $args))]);
}

// ---------- Baarin rajapinta ----------
if (preg_match('#^/v1/events/([^/]+)$#', $path, $m) && in_array($method, ['PUT', 'DELETE'], true)) {
    $pub = authPub(); $ext = $m[1];
    if (!preg_match($extId, $ext)) fail('Virheellinen tunniste');
    $pid = (int)$pub['id'];
    if ($method === 'DELETE') { q("DELETE FROM events WHERE pub_id = ? AND external_id = ?", 'is', [$pid, $ext]); out(['success' => true]); }
    $d = body();
    $title = str($d['title'] ?? null, 160, 'title', true); $date = dateStr($d['date'] ?? null, 'date');
    $ts = timeStr($d['time_start'] ?? null, 'time_start', false); $te = timeStr($d['time_end'] ?? null, 'time_end', false);
    $desc = str($d['description'] ?? null, 1000, 'description'); $type = str($d['type'] ?? null, 40, 'type');
    $price = str($d['price_text'] ?? null, 60, 'price_text'); $url = safeUrl($d['url'] ?? null);
    if ((int)one(q("SELECT COUNT(*) c FROM events WHERE pub_id = ?", 'i', [$pid]))['c'] >= 2000) fail('Tapahtumaraja täynnä', 409);
    q("INSERT INTO events (pub_id, external_id, title, description, date, time_start, time_end, type, price_text, url) VALUES (?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE title = VALUES(title), description = VALUES(description), date = VALUES(date), time_start = VALUES(time_start), time_end = VALUES(time_end), type = VALUES(type), price_text = VALUES(price_text), url = VALUES(url)",
        'isssssssss', [$pid, $ext, $title, $desc, $date, $ts, $te, $type, $price, $url]);
    out(['success' => true]);
}
if (preg_match('#^/v1/shifts/([^/]+)$#', $path, $m) && in_array($method, ['PUT', 'DELETE'], true)) {
    $pub = authPub(); $ext = $m[1];
    if (!preg_match($extId, $ext)) fail('Virheellinen tunniste');
    $pid = (int)$pub['id'];
    if ($method === 'DELETE') { q("DELETE FROM shifts WHERE pub_id = ? AND external_id = ?", 'is', [$pid, $ext]); out(['success' => true]); }
    $d = body();
    $date = dateStr($d['date'] ?? null, 'date'); $ts = timeStr($d['time_start'] ?? null, 'time_start', true); $te = timeStr($d['time_end'] ?? null, 'time_end', true);
    $role = str($d['role'] ?? null, 60, 'role'); $pay = str($d['pay_text'] ?? null, 80, 'pay_text'); $note = str($d['note'] ?? null, 300, 'note');
    $status = $d['status'] ?? 'open'; if (!in_array($status, ['open', 'filled', 'cancelled'], true)) fail('Virheellinen status');
    if ((int)one(q("SELECT COUNT(*) c FROM shifts WHERE pub_id = ?", 'i', [$pid]))['c'] >= 2000) fail('Vuororaja täynnä', 409);
    q("INSERT INTO shifts (pub_id, external_id, date, time_start, time_end, role, pay_text, note, status) VALUES (?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE date = VALUES(date), time_start = VALUES(time_start), time_end = VALUES(time_end), role = VALUES(role), pay_text = VALUES(pay_text), note = VALUES(note), status = VALUES(status)",
        'issssssss', [$pid, $ext, $date, $ts, $te, $role, $pay, $note, $status]);
    out(['success' => true]);
}
if ($method === 'GET' && $path === '/v1/applications') {
    $pub = authPub(); $since = max(0, (int)($_GET['since_id'] ?? 0));
    $rs = rows(q("SELECT a.id, s.external_id AS shift, a.status, a.message, a.created_at, w.name, w.skills, w.city,
                         IF(a.status = 'accepted', w.email, NULL) AS email, IF(a.status = 'accepted', w.phone, NULL) AS phone
                  FROM applications a JOIN shifts s ON s.id = a.shift_id JOIN workers w ON w.id = a.worker_id
                  WHERE s.pub_id = ? AND a.id > ? AND a.status <> 'withdrawn' ORDER BY a.id LIMIT 200", 'ii', [(int)$pub['id'], $since]));
    out(['applications' => $rs]);
}
if ($method === 'POST' && preg_match('#^/v1/applications/(\d+)/decision$#', $path, $m)) {
    $pub = authPub(); $d = body(); $dec = $d['decision'] ?? '';
    if (!in_array($dec, ['accepted', 'declined'], true)) fail('Virheellinen päätös');
    $a = one(q("SELECT a.id, a.status, a.shift_id FROM applications a JOIN shifts s ON s.id = a.shift_id WHERE a.id = ? AND s.pub_id = ?", 'ii', [(int)$m[1], (int)$pub['id']]));
    if (!$a) fail('Ei löydy', 404);
    if ($a['status'] !== 'pending') fail('Hakemus on jo käsitelty', 409);
    q("UPDATE applications SET status = ?, decided_at = NOW() WHERE id = ?", 'si', [$dec, (int)$a['id']]);
    if ($dec === 'accepted') {
        q("UPDATE shifts SET status = 'filled' WHERE id = ?", 'i', [(int)$a['shift_id']]);
        q("UPDATE applications SET status = 'declined', decided_at = NOW() WHERE shift_id = ? AND status = 'pending'", 'i', [(int)$a['shift_id']]);
    }
    out(['success' => true]);
}

// ---------- Keikkatyöntekijä ----------
if ($method === 'POST' && $path === '/v1/workers') {
    rateLimit('reg:' . ($_SERVER['REMOTE_ADDR'] ?? ''), 10, 3600);
    $d = body();
    $email = strtolower((string)str($d['email'] ?? null, 190, 'email', true));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Virheellinen sähköposti');
    $name = str($d['name'] ?? null, 120, 'name', true); if (mb_strlen($name) < 2) fail('Nimi on liian lyhyt');
    $pw = $d['password'] ?? ''; if (!is_string($pw) || strlen($pw) < 10 || strlen($pw) > 200) fail('Salasanan pituus 10–200 merkkiä');
    $phone = str($d['phone'] ?? null, 40, 'phone'); $city = (string)str($d['city'] ?? null, 80, 'city'); $skills = (string)str($d['skills'] ?? null, 300, 'skills');
    if (one(q("SELECT id FROM workers WHERE email = ?", 's', [$email]))) fail('Sähköposti on jo käytössä', 409);
    q("INSERT INTO workers (email, name, phone, city, skills, password_hash) VALUES (?,?,?,?,?,?)", 'ssssss', [$email, $name, $phone, $city, $skills, password_hash($pw, PASSWORD_DEFAULT)]);
    out(['success' => true], 201);
}
if ($method === 'POST' && $path === '/v1/login') {
    $d = body(); $email = strtolower((string)($d['email'] ?? ''));
    rateLimit('login:' . $email, 8); rateLimit('loginip:' . ($_SERVER['REMOTE_ADDR'] ?? ''), 30);
    $w = one(q("SELECT id, password_hash FROM workers WHERE email = ?", 's', [$email]));
    $ok = password_verify((string)($d['password'] ?? ''), $w['password_hash'] ?? '$2y$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012346');
    if (!$w || !$ok) fail('Väärä sähköposti tai salasana', 401);
    $tok = bin2hex(random_bytes(32));
    q("INSERT INTO sessions (token_hash, worker_id, expires_at) VALUES (?, ?, NOW() + INTERVAL 14 DAY)", 'si', [hash('sha256', $tok), (int)$w['id']]);
    q("DELETE FROM sessions WHERE expires_at < NOW()");
    out(['token' => $tok]);
}
if ($path === '/v1/me') {
    $w = authWorker();
    if ($method === 'GET') out(['email' => $w['email'], 'name' => $w['name'], 'phone' => $w['phone'], 'city' => $w['city'], 'skills' => $w['skills']]);
    if ($method === 'PUT') {
        $d = body();
        $name = str($d['name'] ?? $w['name'], 120, 'name', true); $phone = str($d['phone'] ?? $w['phone'], 40, 'phone');
        $city = (string)str($d['city'] ?? $w['city'], 80, 'city'); $skills = (string)str($d['skills'] ?? $w['skills'], 300, 'skills');
        q("UPDATE workers SET name = ?, phone = ?, city = ?, skills = ? WHERE id = ?", 'ssssi', [$name, $phone, $city, $skills, (int)$w['id']]);
        out(['success' => true]);
    }
    if ($method === 'DELETE') {
        $d = body(); rateLimit('del:' . $w['id'], 5);
        if (!password_verify((string)($d['password'] ?? ''), $w['password_hash'])) fail('Salasana on väärä', 403);
        q("DELETE FROM workers WHERE id = ?", 'i', [(int)$w['id']]);   // kaskadi poistaa istunnot ja hakemukset
        out(['success' => true]);
    }
}
if ($method === 'GET' && $path === '/v1/open_shifts') {
    authWorker();
    $sql = "SELECT s.id, s.date, s.time_start, s.time_end, s.role, s.pay_text, s.note, p.name AS pub, p.city FROM shifts s JOIN pubs p ON p.id = s.pub_id
            WHERE p.status = 'active' AND s.status = 'open' AND s.date >= CURDATE()"; $types = ''; $args = [];
    if (!empty($_GET['city'])) { $sql .= " AND p.city = ?"; $types = 's'; $args[] = (string)$_GET['city']; }
    out(['shifts' => rows(q($sql . " ORDER BY s.date, s.time_start LIMIT 200", $types, $args))]);
}
if ($method === 'POST' && preg_match('#^/v1/shifts/(\d+)/apply$#', $path, $m)) {
    $w = authWorker(); $d = body(); rateLimit('apply:' . $w['id'], 30, 3600);
    $s = one(q("SELECT s.id FROM shifts s JOIN pubs p ON p.id = s.pub_id WHERE s.id = ? AND s.status = 'open' AND s.date >= CURDATE() AND p.status = 'active'", 'i', [(int)$m[1]]));
    if (!$s) fail('Vuoro ei ole haettavissa', 404);
    $msg = str($d['message'] ?? null, 500, 'message');
    q("INSERT INTO applications (shift_id, worker_id, message) VALUES (?,?,?) ON DUPLICATE KEY UPDATE message = IF(status IN ('withdrawn'), VALUES(message), message), status = IF(status = 'withdrawn', 'pending', status)", 'iis', [(int)$s['id'], (int)$w['id'], $msg]);
    out(['success' => true], 201);
}
if ($method === 'GET' && $path === '/v1/my_applications') {
    $w = authWorker();
    out(['applications' => rows(q("SELECT a.id, a.status, a.message, a.created_at, s.date, s.time_start, s.time_end, s.role, p.name AS pub FROM applications a
        JOIN shifts s ON s.id = a.shift_id JOIN pubs p ON p.id = s.pub_id WHERE a.worker_id = ? ORDER BY a.id DESC LIMIT 100", 'i', [(int)$w['id']]))]);
}
if ($method === 'POST' && preg_match('#^/v1/applications/(\d+)/withdraw$#', $path, $m)) {
    $w = authWorker();
    q("UPDATE applications SET status = 'withdrawn' WHERE id = ? AND worker_id = ? AND status = 'pending'", 'ii', [(int)$m[1], (int)$w['id']]);
    out(['success' => true]);
}

if ($path === '/' || $path === '/index.html') { header('Content-Type: text/html; charset=utf-8'); readfile(__DIR__ . '/calendar.html'); exit; }
if ($path === '/calendar.js') { header('Content-Type: application/javascript; charset=utf-8'); readfile(__DIR__ . '/calendar.js'); exit; }
fail('Ei löydy', 404);

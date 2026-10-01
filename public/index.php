<?php
declare(strict_types=1);
require __DIR__ . '/../lib/core.php';
require __DIR__ . '/../lib/auth.php';
require __DIR__ . '/../lib/settings.php';
require __DIR__ . '/../lib/admin.php';
require __DIR__ . '/../lib/stats.php';

set_exception_handler(function (Throwable $e) { error_log((string)$e); fail('Palvelinvirhe', 500); });
header('X-Content-Type-Options: nosniff'); header('Referrer-Policy: strict-origin-when-cross-origin');   // OSM-karttapalikat vaativat Referer-otsakkeen (muuten 403 Access blocked)

$method = $_SERVER['REQUEST_METHOD'];
$path = rtrim((string)parse_url(relUri(), PHP_URL_PATH), '/') ?: '/';

// CORS: julkinen kalenteri kaikille, muut vain sallituille origineille
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($path, ['/api/events', '/api/config', '/public/events', '/public/config'], true)) header('Access-Control-Allow-Origin: *');
elseif ($origin !== '' && in_array($origin, cfg()['allowed_origins'] ?? [], true)) { header("Access-Control-Allow-Origin: $origin"); header('Vary: Origin'); }
if ($method === 'OPTIONS') { header('Access-Control-Allow-Headers: Authorization, Content-Type'); header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE'); http_response_code(204); exit; }

if (strncmp($path, '/admin/api/', 11) === 0) handleAdminApi($method, substr($path, 10));
if ($path === '/admin' || $path === '/admin.html') { header('Content-Type: text/html; charset=utf-8'); header("Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"); readfile(__DIR__ . '/admin.html'); exit; }
$extId = '/^[A-Za-z0-9_.-]{1,64}$/';
$m = [];

// ---------- Julkinen ----------
// Julkiset osoitteet: /api/events ja /api/config (vanhat /public/… toimivat edelleen; /public on myös hakemiston nimi, joten /api on turvallisempi)
if (in_array($path, ['/public/config', '/public/events'], true)) $path = '/api' . substr($path, 7);
if ($path === '/events' || $path === '/config') $path = '/api' . $path;   // kun asennus on public/-hakemiston kautta (alihakemisto)
if ($method === 'GET' && $path === '/api/config') {
    out(['site_name' => setting('site_name'), 'footer_text' => setting('footer_text'), 'calendar_enabled' => setting('calendar_enabled') === '1',
         'tile_url' => setting('map_tile_url') ?: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', 'cities' => array_column(rows(q("SELECT DISTINCT p.city FROM pubs p JOIN events e ON e.pub_id = p.id WHERE p.status = 'active' AND p.city <> '' AND e.date >= CURDATE() ORDER BY p.city")), 'city')]);
}
if ($method === 'GET' && $path === '/api/events') {
    if (setting('calendar_enabled') !== '1') out(['events' => []]);
    $from = isset($_GET['from']) ? dateStr($_GET['from'], 'from') : date('Y-m-d');
    $to = isset($_GET['to']) ? dateStr($_GET['to'], 'to') : date('Y-m-d', strtotime('+' . (int)setting('calendar_days_ahead') . ' days'));
    $limit = max(1, min(500, (int)($_GET['limit'] ?? 200)));
    $city = isset($_GET['city']) ? (string)$_GET['city'] : '';
    $sql = "SELECT e.id, e.title, e.description, e.date, e.time_start, e.time_end, e.type, e.price_text, e.url, p.name AS pub, p.city, p.address, p.lat, p.lng, p.website
            FROM events e JOIN pubs p ON p.id = e.pub_id WHERE p.status = 'active' AND e.date BETWEEN ? AND ?";
    $types = 'ss'; $args = [$from, $to];
    if ($city !== '') { $sql .= " AND p.city = ?"; $types .= 's'; $args[] = $city; }
    $sql .= " ORDER BY e.date, e.time_start LIMIT $limit";
    $evs = rows(q($sql, $types, $args));
    foreach ($evs as &$e) { $e['id'] = (int)$e['id']; $e['lat'] = $e['lat'] === null ? null : (float)$e['lat']; $e['lng'] = $e['lng'] === null ? null : (float)$e['lng']; } unset($e);
    out(['events' => $evs]);
}

if ($method === 'POST' && $path === '/api/track') handleTrack();   // kalenterin käyttötilasto (nimetön)

// ---------- Liittäminen (liitoskoodilla; ei allekirjoitusta, koska avain rekisteröidään tässä) ----------
if ($method === 'POST' && $path === '/v1/pair') {
    rateLimit('pair:' . ($_SERVER['REMOTE_ADDR'] ?? ''), 10, 3600);
    $d = body(); $code = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)($d['code'] ?? '')));
    $pk = base64_decode((string)($d['public_key'] ?? ''), true);
    if (strlen($code) !== 20) fail('Virheellinen liitoskoodi', 400);
    if ($pk === false || strlen($pk) !== SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES) fail('Virheellinen julkinen avain', 400);
    $p = one(q("SELECT id, slug, name, city, status FROM pubs WHERE pair_hash = ? AND pair_expires > NOW()", 's', [hash('sha256', $code)]));
    if (!$p) fail('Liitoskoodi on väärä tai vanhentunut', 404);
    $status = $p['status'] === 'suspended' ? 'suspended' : 'active';
    q("UPDATE pubs SET public_key = ?, status = ?, pair_hash = NULL, pair_expires = NULL WHERE id = ?", 'ssi', [base64_encode($pk), $status, (int)$p['id']]);
    out(['success' => true, 'slug' => $p['slug'], 'name' => $p['name'], 'city' => $p['city']]);
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
if ($method === 'PUT' && $path === '/v1/profile') {   // baarin julkinen sijainti ja osoite (kartta); vain julkisia tietoja
    $pub = authPub(); $d = body();
    $addr = str($d['address'] ?? null, 200, 'address'); $city = (string)str($d['city'] ?? null, 80, 'city'); $site = safeUrl($d['website'] ?? null);
    $lat = $d['lat'] ?? null; $lng = $d['lng'] ?? null;
    if ($lat !== null || $lng !== null) {
        if (!is_numeric($lat) || !is_numeric($lng) || $lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) fail('Virheelliset koordinaatit');
        $lat = round((float)$lat, 6); $lng = round((float)$lng, 6);
    }
    q("UPDATE pubs SET address = ?, city = IF(? = '', city, ?), lat = ?, lng = ?, website = ? WHERE id = ?", 'sssddsi', [$addr, $city, $city, $lat, $lng, $site, (int)$pub['id']]);
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
    $rs = rows(q("SELECT a.id, s.external_id AS shift, a.status, a.message, a.created_at,
                         COALESCE(a.applicant_name, w.name) AS name, COALESCE(a.applicant_skills, w.skills) AS skills, COALESCE(w.city, ap.city) AS city, ap.name AS from_pub,
                         IF(a.status = 'accepted', COALESCE(a.applicant_email, w.email), NULL) AS email, IF(a.status = 'accepted', COALESCE(a.applicant_phone, w.phone), NULL) AS phone
                  FROM applications a JOIN shifts s ON s.id = a.shift_id LEFT JOIN workers w ON w.id = a.worker_id LEFT JOIN pubs ap ON ap.id = a.from_pub_id
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

// ---------- Baarien välinen keikkapörssi (baari hakee vuoroja omille työntekijöilleen) ----------
// Keskus välittää vain: toisten baarien avoimet vuorot (julkista tietoa) ja hakemukset. Hakijan tiedot menevät ainoastaan vuoron tarjonneelle baarille.
if ($method === 'GET' && $path === '/v1/feed') {
    $pub = authPub(); rateLimit('feed:' . $pub['id'], 600, 3600);
    $sql = "SELECT s.id, s.date, s.time_start, s.time_end, s.role, s.pay_text, s.note, s.updated_at, p.name AS pub, p.city FROM shifts s JOIN pubs p ON p.id = s.pub_id
            WHERE p.status = 'active' AND p.id <> ? AND s.status = 'open' AND s.date >= CURDATE()"; $types = 'i'; $args = [(int)$pub['id']];
    if (!empty($_GET['city'])) { $sql .= " AND p.city = ?"; $types .= 's'; $args[] = (string)$_GET['city']; }
    out(['shifts' => rows(q($sql . " ORDER BY s.date, s.time_start LIMIT 300", $types, $args))]);
}
if ($method === 'POST' && preg_match('#^/v1/feed/(\d+)/apply$#', $path, $m)) {
    $pub = authPub(); $d = body(); rateLimit('feedapply:' . $pub['id'], 60, 3600);
    $s = one(q("SELECT s.id FROM shifts s JOIN pubs p ON p.id = s.pub_id WHERE s.id = ? AND s.pub_id <> ? AND s.status = 'open' AND s.date >= CURDATE() AND p.status = 'active'", 'ii', [(int)$m[1], (int)$pub['id']]));
    if (!$s) fail('Vuoro ei ole haettavissa', 404);
    $ref = (string)($d['ref'] ?? ''); if (!preg_match('/^[A-Za-z0-9_-]{1,64}$/', $ref)) fail('Virheellinen hakijan tunniste');
    $name = str($d['name'] ?? null, 120, 'name', true); if (mb_strlen($name) < 2) fail('Nimi on liian lyhyt');
    $phone = str($d['phone'] ?? null, 40, 'phone'); $email = str($d['email'] ?? null, 190, 'email'); $skills = str($d['skills'] ?? null, 300, 'skills'); $msg = str($d['message'] ?? null, 500, 'message');
    if ($email !== null && !filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Virheellinen sähköposti');
    if ($phone === null && $email === null) fail('Anna puhelinnumero tai sähköposti, jotta baari voi ottaa yhteyttä');
    q("INSERT INTO applications (shift_id, worker_id, from_pub_id, applicant_ref, applicant_name, applicant_phone, applicant_email, applicant_skills, message) VALUES (?,NULL,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE message = IF(status = 'withdrawn', VALUES(message), message), applicant_name = IF(status = 'withdrawn', VALUES(applicant_name), applicant_name),
         applicant_phone = IF(status = 'withdrawn', VALUES(applicant_phone), applicant_phone), applicant_email = IF(status = 'withdrawn', VALUES(applicant_email), applicant_email),
         applicant_skills = IF(status = 'withdrawn', VALUES(applicant_skills), applicant_skills), status = IF(status = 'withdrawn', 'pending', status)",
        'iissssss', [(int)$s['id'], (int)$pub['id'], $ref, $name, $phone, $email, $skills, $msg]);
    $a = one(q("SELECT id, status FROM applications WHERE shift_id = ? AND from_pub_id = ? AND applicant_ref = ?", 'iis', [(int)$s['id'], (int)$pub['id'], $ref]));
    out(['success' => true, 'id' => (int)$a['id'], 'status' => $a['status']], 201);
}
if ($method === 'GET' && $path === '/v1/outgoing_applications') {
    $pub = authPub();
    $rs = rows(q("SELECT a.id, a.applicant_ref AS ref, a.status, a.created_at, a.decided_at, s.id AS shift_id, s.date, s.time_start, s.time_end, s.role, s.status AS shift_status, p.name AS pub, p.city, p.website,
                         IF(a.status = 'accepted', p.address, NULL) AS address
                  FROM applications a JOIN shifts s ON s.id = a.shift_id JOIN pubs p ON p.id = s.pub_id
                  WHERE a.from_pub_id = ? AND a.status <> 'withdrawn' ORDER BY a.id DESC LIMIT 200", 'i', [(int)$pub['id']]));
    out(['applications' => $rs]);
}
if ($method === 'POST' && preg_match('#^/v1/outgoing_applications/(\d+)/withdraw$#', $path, $m)) {
    $pub = authPub();
    $st = q("UPDATE applications SET status = 'withdrawn' WHERE id = ? AND from_pub_id = ? AND status = 'pending'", 'ii', [(int)$m[1], (int)$pub['id']]);
    out(['success' => true, 'changed' => $st->affected_rows > 0]);
}

// ---------- Keikkatyöntekijä ----------
if ($method === 'POST' && $path === '/v1/workers') {
    if (setting('worker_registration') !== '1') fail('Rekisteröinti on suljettu', 403);
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

$assets = ['/' => ['calendar.html', 'text/html'], '/index.html' => ['calendar.html', 'text/html'], '/calendar.js' => ['calendar.js', 'application/javascript'], '/admin.js' => ['admin.js', 'application/javascript'], '/hub.css' => ['hub.css', 'text/css'], '/calendar.css' => ['calendar.css', 'text/css']];
$statics = ['/leaflet/leaflet.js' => ['leaflet/leaflet.js', 'application/javascript'], '/leaflet/leaflet.css' => ['leaflet/leaflet.css', 'text/css'], '/leaflet/images/marker-icon.png' => ['leaflet/images/marker-icon.png', 'image/png'], '/leaflet/images/marker-icon-2x.png' => ['leaflet/images/marker-icon-2x.png', 'image/png'], '/leaflet/images/marker-shadow.png' => ['leaflet/images/marker-shadow.png', 'image/png'], '/leaflet/images/layers.png' => ['leaflet/images/layers.png', 'image/png'], '/leaflet/images/layers-2x.png' => ['leaflet/images/layers-2x.png', 'image/png']];
if ($method === 'GET' && isset($statics[$path])) { header('Content-Type: ' . $statics[$path][1]); header('Cache-Control: public, max-age=86400'); readfile(__DIR__ . '/' . $statics[$path][0]); exit; }
if ($method === 'GET' && isset($assets[$path])) {
    header('Content-Type: ' . $assets[$path][1] . '; charset=utf-8'); header('Cache-Control: no-cache');
    // kalenterisivu saa olla upotettuna mihin tahansa sivuun (iframe); hallintasivu ei
    $embeddable = in_array($assets[$path][0], ['calendar.html', 'calendar.js', 'calendar.css'], true);
    header("Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: " . tileOrigin() . "; base-uri 'self'; form-action 'none'" . ($embeddable ? '; frame-ancestors *' : "; frame-ancestors 'none'"));
    readfile(__DIR__ . '/' . $assets[$path][0]); exit;
}
fail('Ei löydy', 404);

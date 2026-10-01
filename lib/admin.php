<?php
declare(strict_types=1);
// Hallintasivun API (/admin/api/*). Istunto: PHP-sessio (HttpOnly, SameSite=Strict). CSRF: vaaditaan oma otsake X-Hub-Admin (selain ei lähetä sitä ristiin ilman CORS-esitarkistusta).

function adminSessionStart(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_name('hubadmin');
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Strict']);
    ini_set('session.use_strict_mode', '1');
    session_start();
    if (isset($_SESSION['last']) && time() - (int)$_SESSION['last'] > 4 * 3600) $_SESSION = [];
    if (isset($_SESSION['aid'])) $_SESSION['last'] = time();
}
function adminRequire(): array {
    if (empty($_SESSION['aid'])) fail('Kirjaudu sisään', 401);
    $a = one(q("SELECT id, username FROM admins WHERE id = ?", 'i', [(int)$_SESSION['aid']]));
    if (!$a) { $_SESSION = []; fail('Kirjaudu sisään', 401); }
    return $a;
}
function newKeypair(): array {
    $kp = sodium_crypto_sign_keypair();
    return ['public' => base64_encode(sodium_crypto_sign_publickey($kp)), 'private' => base64_encode(sodium_crypto_sign_secretkey($kp))];
}
// Kertakäyttöinen liitoskoodi (7 pv). Baarin client luo oman avainparin ja rekisteröi julkisen avaimen koodilla; yksityinen avain ei koskaan poistu clientista.
function newPairingCode(int $pubId): string {
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; $raw = '';
    for ($i = 0; $i < 20; $i++) $raw .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    q("UPDATE pubs SET pair_hash = ?, pair_expires = NOW() + INTERVAL 7 DAY WHERE id = ?", 'si', [hash('sha256', $raw), $pubId]);
    return implode('-', str_split($raw, 5));
}
function pairingUrl(): string {
    $scheme = ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')) ? 'https' : 'http';
    return $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'hub.example.com') . hubBase();
}
function configSnippet(string $slug, string $private): string {
    $scheme = ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')) ? 'https' : 'http';
    $url = $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'hub.example.com') . hubBase();
    return "'hub' => ['url' => '$url', 'pub_slug' => '$slug', 'private_key' => '$private'],";
}

function handleAdminApi(string $method, string $rel): never {
    adminSessionStart();
    if (($_SERVER['HTTP_X_HUB_ADMIN'] ?? '') !== '1') fail('Virheellinen pyyntö', 403);
    $m = [];
    if ($method === 'POST' && $rel === '/login') {
        $d = body(); $u = strtolower(trim((string)($d['username'] ?? '')));
        rateLimit('adminlogin:' . $u, 8); rateLimit('adminloginip:' . ($_SERVER['REMOTE_ADDR'] ?? ''), 30);
        $a = one(q("SELECT id, password_hash FROM admins WHERE username = ?", 's', [$u]));
        $ok = password_verify((string)($d['password'] ?? ''), $a['password_hash'] ?? '$2y$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012346');
        if (!$a || !$ok) fail('Väärä tunnus tai salasana', 401);
        session_regenerate_id(true); $_SESSION = ['aid' => (int)$a['id'], 'last' => time()];
        out(['success' => true, 'username' => $u]);
    }
    if ($method === 'POST' && $rel === '/logout') { $_SESSION = []; session_destroy(); out(['success' => true]); }
    $admin = adminRequire();

    if ($method === 'GET' && $rel === '/me') out(['username' => $admin['username']]);
    if ($method === 'GET' && $rel === '/overview') {
        $c = fn(string $sql) => (int)one(q($sql))['c'];
        out(['pubs' => $c("SELECT COUNT(*) c FROM pubs"), 'pubs_active' => $c("SELECT COUNT(*) c FROM pubs WHERE status = 'active'"),
             'events' => $c("SELECT COUNT(*) c FROM events WHERE date >= CURDATE()"), 'open_shifts' => $c("SELECT COUNT(*) c FROM shifts WHERE status = 'open' AND date >= CURDATE()"),
             'workers' => $c("SELECT COUNT(*) c FROM workers"), 'pending_applications' => $c("SELECT COUNT(*) c FROM applications WHERE status = 'pending'")]);
    }
    if ($method === 'GET' && $rel === '/settings') out(['settings' => settingsAll()]);
    if ($method === 'PUT' && $rel === '/settings') { settingsSave(settingsValidate(body())); out(['success' => true, 'settings' => settingsAll()]); }
    if ($method === 'POST' && $rel === '/password') {
        $d = body(); $a = one(q("SELECT password_hash FROM admins WHERE id = ?", 'i', [(int)$admin['id']]));
        if (!password_verify((string)($d['current'] ?? ''), $a['password_hash'])) fail('Nykyinen salasana on väärä', 403);
        $n = (string)($d['new'] ?? ''); if (strlen($n) < 12 || strlen($n) > 200) fail('Uuden salasanan pituus 12–200 merkkiä');
        q("UPDATE admins SET password_hash = ? WHERE id = ?", 'si', [password_hash($n, PASSWORD_DEFAULT), (int)$admin['id']]);
        out(['success' => true]);
    }

    // ----- Baarit -----
    if ($method === 'GET' && $rel === '/pubs') {
        out(['pubs' => rows(q("SELECT p.id, p.slug, p.name, p.city, p.status, p.created_at, p.last_seen_at,
            (SELECT COUNT(*) FROM events e WHERE e.pub_id = p.id AND e.date >= CURDATE()) AS events,
            (SELECT COUNT(*) FROM shifts s WHERE s.pub_id = p.id AND s.status = 'open' AND s.date >= CURDATE()) AS open_shifts, (p.public_key <> '') AS paired, (p.pair_hash IS NOT NULL AND p.pair_expires > NOW()) AS code_valid FROM pubs p ORDER BY p.name"))]);
    }
    if ($method === 'POST' && $rel === '/pubs') {
        $d = body(); $slug = strtolower(trim((string)($d['slug'] ?? '')));
        if (!preg_match('/^[a-z0-9_-]{1,64}$/', $slug)) fail('Tunnus (slug): 1–64 merkkiä a–z, 0–9, - tai _');
        $name = str($d['name'] ?? null, 120, 'name', true); $city = (string)str($d['city'] ?? null, 80, 'city');
        if (one(q("SELECT id FROM pubs WHERE slug = ?", 's', [$slug]))) fail('Tunnus on jo käytössä', 409);
        q("INSERT INTO pubs (slug, name, city, public_key, status) VALUES (?,?,?,?, 'pending')", 'ssss', [$slug, $name, $city, '']);
        $id = (int)db()->insert_id;
        out(['success' => true, 'slug' => $slug, 'code' => newPairingCode($id), 'url' => pairingUrl()], 201);
    }
    if (preg_match('#^/pubs/(\d+)$#', $rel, $m)) {
        $id = (int)$m[1]; if (!one(q("SELECT id FROM pubs WHERE id = ?", 'i', [$id]))) fail('Ei löydy', 404);
        if ($method === 'PUT') {
            $d = body(); $name = str($d['name'] ?? null, 120, 'name', true); $city = (string)str($d['city'] ?? null, 80, 'city');
            $status = $d['status'] ?? 'active'; if (!in_array($status, ['active', 'suspended'], true)) fail('Virheellinen tila');
            if ($status === 'active' && one(q("SELECT id FROM pubs WHERE id = ? AND public_key = ''", 'i', [$id]))) fail('Baari ei ole vielä liitetty: anna sille liitoskoodi');
            q("UPDATE pubs SET name = ?, city = ?, status = ? WHERE id = ?", 'sssi', [$name, $city, $status, $id]); out(['success' => true]);
        }
        if ($method === 'DELETE') { q("DELETE FROM pubs WHERE id = ?", 'i', [$id]); out(['success' => true]); }
    }
    if ($method === 'POST' && preg_match('#^/pubs/(\d+)/pairing_code$#', $rel, $m)) {   // uusi liitoskoodi (uusi yhteys / avaimen vaihto; vanha avain toimii kunnes uusi liitetään)
        $p = one(q("SELECT id, slug FROM pubs WHERE id = ?", 'i', [(int)$m[1]])); if (!$p) fail('Ei löydy', 404);
        out(['success' => true, 'slug' => $p['slug'], 'code' => newPairingCode((int)$p['id']), 'url' => pairingUrl()]);
    }

    // ----- Sisältö -----
    if ($method === 'GET' && $rel === '/events') out(['events' => rows(q("SELECT e.id, e.title, e.date, e.time_start, e.type, e.price_text, e.url, p.name AS pub, p.city FROM events e JOIN pubs p ON p.id = e.pub_id ORDER BY e.date DESC, e.time_start LIMIT 300"))]);
    if ($method === 'DELETE' && preg_match('#^/events/(\d+)$#', $rel, $m)) { q("DELETE FROM events WHERE id = ?", 'i', [(int)$m[1]]); out(['success' => true]); }
    if ($method === 'GET' && $rel === '/shifts') out(['shifts' => rows(q("SELECT s.id, s.date, s.time_start, s.time_end, s.role, s.pay_text, s.status, p.name AS pub,
        (SELECT COUNT(*) FROM applications a WHERE a.shift_id = s.id) AS applications FROM shifts s JOIN pubs p ON p.id = s.pub_id ORDER BY s.date DESC LIMIT 300"))]);
    if ($method === 'DELETE' && preg_match('#^/shifts/(\d+)$#', $rel, $m)) { q("DELETE FROM shifts WHERE id = ?", 'i', [(int)$m[1]]); out(['success' => true]); }
    if ($method === 'GET' && $rel === '/workers') out(['workers' => rows(q("SELECT w.id, w.name, w.email, w.city, w.skills, w.created_at, (SELECT COUNT(*) FROM applications a WHERE a.worker_id = w.id) AS applications FROM workers w ORDER BY w.created_at DESC LIMIT 300"))]);
    if ($method === 'DELETE' && preg_match('#^/workers/(\d+)$#', $rel, $m)) { q("DELETE FROM workers WHERE id = ?", 'i', [(int)$m[1]]); out(['success' => true]); }
    fail('Ei löydy', 404);
}

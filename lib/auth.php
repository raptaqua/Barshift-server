<?php
declare(strict_types=1);

// Baarin allekirjoitettu pyyntö -> palauttaa baarin rivin
function authPub(): array {
    $slug = $_SERVER['HTTP_X_PUB'] ?? ''; $ts = $_SERVER['HTTP_X_TIMESTAMP'] ?? ''; $nonce = $_SERVER['HTTP_X_NONCE'] ?? ''; $sig = $_SERVER['HTTP_X_SIGNATURE'] ?? '';
    if (!preg_match('/^[a-z0-9_-]{1,64}$/', $slug) || !ctype_digit($ts) || !preg_match('/^[A-Za-z0-9_-]{16,64}$/', $nonce) || $sig === '') fail('Allekirjoitus puuttuu', 401);
    if (abs(time() - (int)$ts) > 300) fail('Aikaleima ei kelpaa', 401);
    $pub = one(q("SELECT * FROM pubs WHERE slug = ?", 's', [$slug]));
    if (!$pub || $pub['status'] !== 'active') fail('Tuntematon tai estetty baari', 401);
    $pk = base64_decode($pub['public_key'], true); $sg = base64_decode($sig, true);
    if ($pk === false || strlen($pk) !== SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES || $sg === false || strlen($sg) !== SODIUM_CRYPTO_SIGN_BYTES) fail('Allekirjoitus ei kelpaa', 401);
    $msg = $_SERVER['REQUEST_METHOD'] . "\n" . relUri() . "\n" . $ts . "\n" . $nonce . "\n" . hash('sha256', rawBody());
    if (!sodium_crypto_sign_verify_detached($sg, $msg, $pk)) fail('Allekirjoitus ei kelpaa', 401);
    // kertakäyttöinen nonce (vasta allekirjoituksen tarkistuksen jälkeen)
    q("DELETE FROM nonces WHERE ts < ?", 'i', [time() - 700]);
    $st = db()->prepare("INSERT INTO nonces (pub_id, nonce, ts) VALUES (?, ?, ?)");
    $pid = (int)$pub['id']; $now = time(); $st->bind_param('isi', $pid, $nonce, $now);
    if (!$st->execute()) fail('Nonce on jo käytetty', 401);
    q("UPDATE pubs SET last_seen_at = NOW() WHERE id = ?", 'i', [$pid]);
    return $pub;
}

// Keikkatyöntekijän istunto (Bearer-tunniste)
function authWorker(): array {
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (!preg_match('/^Bearer ([0-9a-f]{64})$/', $h, $m)) fail('Kirjaudu sisään', 401);
    $w = one(q("SELECT w.* FROM sessions s JOIN workers w ON w.id = s.worker_id WHERE s.token_hash = ? AND s.expires_at > NOW()", 's', [hash('sha256', $m[1])]));
    if (!$w) fail('Istunto on vanhentunut', 401);
    return $w;
}

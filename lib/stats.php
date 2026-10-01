<?php
declare(strict_types=1);
// Julkisen kalenterin käyttötilastot. Ei henkilötietoja: IP-osoitetta ei tallenneta, vain päivittäinen nimetön tiiviste uniikkien kävijöiden laskentaan
// (tiiviste vaihtuu joka päivä, joten kävijää ei voi tunnistaa päivien välillä; tiivisteet poistetaan 2 vuorokauden jälkeen).

const STAT_COLS = ['view' => 'views', 'open' => 'opens', 'link' => 'links', 'ics' => 'ics'];

// POST /api/track {t: view|open|link|ics, e?: tapahtuman id}. Vastaus 204 (kävijälle ei näytetä mitään).
function handleTrack(): never {
    $d = body(); $t = (string)($d['t'] ?? '');
    $ua = (string)($_SERVER['HTTP_USER_AGENT'] ?? ''); $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
    if (!isset(STAT_COLS[$t]) || setting('calendar_enabled') !== '1' || $ua === '' || preg_match('/bot|crawl|spider|slurp|preview|facebookexternalhit|headless|monitor|curl|wget/i', $ua)) { http_response_code(204); exit; }
    rateLimit('track:' . $ip, 400, 3600);
    $col = STAT_COLS[$t];
    if ($t !== 'view') {
        $e = (int)($d['e'] ?? 0);
        if ($e <= 0 || !one(q("SELECT id FROM events WHERE id = ?", 'i', [$e]))) { http_response_code(204); exit; }
        q("INSERT INTO stat_event (event_id, $col, last_at) VALUES (?, 1, NOW()) ON DUPLICATE KEY UPDATE $col = $col + 1, last_at = NOW()", 'i', [$e]);
    }
    q("INSERT INTO stat_daily (day, $col) VALUES (CURDATE(), 1) ON DUPLICATE KEY UPDATE $col = $col + 1");
    if ($t === 'view') {   // uniikit kävijät: päivittäin vaihtuva nimetön tiiviste
        $k = hash('sha256', (cfg()['db_name'] ?? '') . (cfg()['db_user'] ?? '') . (cfg()['db_pass'] ?? '') . 'hub-stats');
        $h = substr(hash_hmac('sha256', $ip . '|' . $ua, $k . date('Y-m-d')), 0, 16);
        $st = db()->prepare("INSERT IGNORE INTO stat_seen (day, h) VALUES (CURDATE(), ?)"); $st->bind_param('s', $h); $st->execute();
        if ($st->affected_rows > 0) q("UPDATE stat_daily SET uniques = uniques + 1 WHERE day = CURDATE()");
        if (random_int(1, 50) === 1) q("DELETE FROM stat_seen WHERE day < CURDATE() - INTERVAL 2 DAY");
    }
    http_response_code(204); exit;
}

// Hallinnan tilastot: /admin/api/stats?days=30
function statsReport(int $days): array {
    $days = max(7, min(365, $days));
    $c = fn(string $sql, string $types = '', array $args = []) => (int)one(q($sql, $types, $args))['c'];
    $overview = [
        'pubs' => $c("SELECT COUNT(*) c FROM pubs"), 'pubs_active' => $c("SELECT COUNT(*) c FROM pubs WHERE status = 'active'"), 'pubs_pending' => $c("SELECT COUNT(*) c FROM pubs WHERE status = 'pending'"),
        'events_upcoming' => $c("SELECT COUNT(*) c FROM events WHERE date >= CURDATE()"), 'events_total' => $c("SELECT COUNT(*) c FROM events"),
        'shifts_open' => $c("SELECT COUNT(*) c FROM shifts WHERE status = 'open' AND date >= CURDATE()"), 'shifts_filled' => $c("SELECT COUNT(*) c FROM shifts WHERE status = 'filled'"),
        'shifts_cancelled' => $c("SELECT COUNT(*) c FROM shifts WHERE status = 'cancelled'"), 'shifts_total' => $c("SELECT COUNT(*) c FROM shifts"),
        'workers' => $c("SELECT COUNT(*) c FROM workers"),
        'applications_total' => $c("SELECT COUNT(*) c FROM applications WHERE status <> 'withdrawn'"), 'applications_pending' => $c("SELECT COUNT(*) c FROM applications WHERE status = 'pending'"),
        'applications_accepted' => $c("SELECT COUNT(*) c FROM applications WHERE status = 'accepted'"), 'applications_from_pubs' => $c("SELECT COUNT(*) c FROM applications WHERE from_pub_id IS NOT NULL AND status <> 'withdrawn'"),
    ];
    $perPub = rows(q("SELECT p.id, p.name, p.city, p.status, p.last_seen_at,
        (SELECT COUNT(*) FROM events e WHERE e.pub_id = p.id AND e.date >= CURDATE()) AS events_upcoming,
        (SELECT COUNT(*) FROM events e WHERE e.pub_id = p.id) AS events_total,
        (SELECT COUNT(*) FROM shifts s WHERE s.pub_id = p.id) AS shifts_total,
        (SELECT COUNT(*) FROM shifts s WHERE s.pub_id = p.id AND s.status = 'open' AND s.date >= CURDATE()) AS shifts_open,
        (SELECT COUNT(*) FROM shifts s WHERE s.pub_id = p.id AND s.status = 'filled') AS shifts_filled,
        (SELECT COUNT(*) FROM applications a JOIN shifts s ON s.id = a.shift_id WHERE s.pub_id = p.id AND a.status <> 'withdrawn') AS applications_received,
        (SELECT COUNT(*) FROM applications a WHERE a.from_pub_id = p.id AND a.status <> 'withdrawn') AS applications_sent,
        COALESCE((SELECT SUM(st.opens) FROM stat_event st JOIN events e ON e.id = st.event_id WHERE e.pub_id = p.id), 0) AS event_opens,
        COALESCE((SELECT SUM(st.links) FROM stat_event st JOIN events e ON e.id = st.event_id WHERE e.pub_id = p.id), 0) AS event_links
        FROM pubs p ORDER BY p.name"));
    foreach ($perPub as &$r) foreach ($r as $k => $v) if (!in_array($k, ['name', 'city', 'status', 'last_seen_at'], true)) $r[$k] = (int)$v; unset($r);

    $byDay = []; foreach (rows(q("SELECT day, views, uniques, opens, links, ics FROM stat_daily WHERE day > CURDATE() - INTERVAL ? DAY", 'i', [$days])) as $r) $byDay[$r['day']] = $r;
    $series = [];
    for ($i = $days - 1; $i >= 0; $i--) { $d = date('Y-m-d', strtotime("-$i days")); $r = $byDay[$d] ?? [];
        $series[] = ['day' => $d, 'views' => (int)($r['views'] ?? 0), 'uniques' => (int)($r['uniques'] ?? 0), 'opens' => (int)($r['opens'] ?? 0), 'links' => (int)($r['links'] ?? 0), 'ics' => (int)($r['ics'] ?? 0)]; }
    $tot = one(q("SELECT COALESCE(SUM(views),0) views, COALESCE(SUM(uniques),0) uniques, COALESCE(SUM(opens),0) opens, COALESCE(SUM(links),0) links, COALESCE(SUM(ics),0) ics FROM stat_daily"));
    $win = ['views' => 0, 'uniques' => 0, 'opens' => 0, 'links' => 0, 'ics' => 0]; foreach ($series as $s) foreach ($win as $k => $_) $win[$k] += $s[$k];
    $top = rows(q("SELECT e.id, e.title, e.date, p.name AS pub, st.opens, st.links, st.ics FROM stat_event st JOIN events e ON e.id = st.event_id JOIN pubs p ON p.id = e.pub_id
                   ORDER BY st.opens DESC, st.links DESC LIMIT 10"));
    foreach ($top as &$r) { $r['id'] = (int)$r['id']; $r['opens'] = (int)$r['opens']; $r['links'] = (int)$r['links']; $r['ics'] = (int)$r['ics']; } unset($r);
    return ['days' => $days, 'overview' => $overview, 'pubs' => $perPub, 'calendar' => ['total' => array_map('intval', $tot), 'window' => $win, 'series' => $series, 'top_events' => $top]];
}

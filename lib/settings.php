<?php
declare(strict_types=1);
// Hallintasivulta muutettavat asetukset (taulu settings). Oletukset koodissa; vain tunnetut avaimet hyväksytään.
const HUB_SETTING_DEFAULTS = [
    'site_name' => 'BarShift Hub',
    'calendar_enabled' => '1',          // julkinen kalenterisivu ja /public/events
    'calendar_days_ahead' => '180',     // kuinka pitkälle eteenpäin tapahtumat näytetään (7–730)
    'worker_registration' => '1',       // keikkatyöläisten rekisteröinti päällä
    'footer_text' => '',
    'map_tile_url' => '',                // oma karttapalvelin (https, sisältää {z}/{x}/{y}); tyhjä = OpenStreetMap                // vapaa teksti kalenterisivun alareunaan (enintään 300 merkkiä)
];
function settingsAll(): array {
    static $c; if ($c !== null) return $c;
    $c = HUB_SETTING_DEFAULTS;
    foreach (rows(q("SELECT k, v FROM settings")) as $r) if (array_key_exists($r['k'], $c)) $c[$r['k']] = $r['v'];
    return $c;
}
function setting(string $k): string { return settingsAll()[$k] ?? ''; }
function settingsValidate(array $in): array {
    $out = [];
    foreach ($in as $k => $v) {
        if (!array_key_exists($k, HUB_SETTING_DEFAULTS)) continue;
        $v = is_bool($v) ? ($v ? '1' : '0') : trim((string)$v);
        switch ($k) {
            case 'site_name': if ($v === '' || mb_strlen($v) > 80) fail('Sivuston nimi: 1–80 merkkiä'); break;
            case 'calendar_enabled': case 'worker_registration': $v = in_array($v, ['1', 'true', 'on'], true) ? '1' : '0'; break;
            case 'calendar_days_ahead': if (!ctype_digit($v) || (int)$v < 7 || (int)$v > 730) fail('Päiviä eteenpäin: 7–730'); break;
            case 'map_tile_url': if ($v !== '' && (!preg_match('#^https://[^\s"\'<>]+$#', $v) || !str_contains($v, '{z}') || !str_contains($v, '{x}') || !str_contains($v, '{y}'))) fail('Karttapalvelun osoite: https://… ja sisältää {z}/{x}/{y}'); break;
            case 'footer_text': if (mb_strlen($v) > 300) fail('Alatunniste: enintään 300 merkkiä'); break;
        }
        $out[$k] = $v;
    }
    return $out;
}
function settingsSave(array $vals): void {
    foreach ($vals as $k => $v) q("INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)", 'ss', [$k, $v]);
}

// Karttapalikoiden alkuperä Content-Security-Policyyn
function tileOrigin(): string {
    $u = setting('map_tile_url'); $p = $u !== '' ? parse_url(str_replace(['{z}', '{x}', '{y}', '{s}'], ['0', '0', '0', 'a'], $u)) : null;
    return $p && !empty($p['host']) ? 'https://' . $p['host'] . (!empty($p['port']) ? ':' . $p['port'] : '') : 'https://tile.openstreetmap.org';
}

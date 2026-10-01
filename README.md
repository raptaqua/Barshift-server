# BarShift Hub (barshift-server)

Keskuspalvelin kahteen asiaan: **julkinen tapahtumakalenteri** ja **keikkatyön välitys baarien välillä**.
Baarit ajavat omaa [barshift-client](https://github.com/raptaqua/barshift-client)-asennustaan (oma kanta, ei muita baareja); keskus ei koskaan sisällä baarin sisäistä dataa.

Rajapinta ja tietoturvaperiaatteet: [API.md](API.md).

## Asennus
```
cp config.example.php config.php      # täytä tietokanta
php bin/install.php                   # luo taulut

php bin/add_pub.php baari-a "Baari A" "Turku" <public_key>
php bin/add_pub.php --suspend baari-a # estä baari
```
Web-juuri on `public/` (kaikki pyynnöt `public/index.php`:lle). Cron päivittäin: `php bin/cleanup.php`.

## Hallintasivu
Luo hallintatunnus: `php bin/admin.php create <tunnus>` ja kirjaudu osoitteessa `/admin`. Sivulta: baarien lisäys (palvelin luo avainparin ja näyttää client-asennuksen `config.php`-rivin kerran), esto/aktivointi, avaimen vaihto, tapahtumien ja keikkavuorojen poisto, keikkatyöläisten hallinta ja asetukset (sivuston nimi, kalenterin pituus, kalenteri ja rekisteröinti päälle/pois).

## Asennuspolku
Web-juuri voi olla `public/` (`.htaccess` ohjaa pyynnöt `index.php`:lle) tai repon juuri (juuren `index.php` + `.htaccess`). Alihakemisto (esim. `https://sivu.fi/hub/`) toimii: asennuspolku tunnistetaan automaattisesti tai asetetaan `config.php`:ssä (`'base_path' => '/hub'`). Baarin `hub.url` on silloin `https://sivu.fi/hub`.

## Testit
`TEST_DB_HOST=localhost bash tests/run.sh` (vaatii php + mysqli + sodium, MariaDB, node 18+; testikanta TYHJENNETÄÄN).

## Tietoturva lyhyesti
- Baarin pyynnöt allekirjoitetaan Ed25519:llä (+ aikaleima ja kertakäyttöinen nonce); keskus ei kutsu baareja koskaan.
- Julkaistaan vain julkiset kentät; keikkatyöntekijän yhteystiedot paljastuvat baarille vasta hyväksynnässä; tilin poisto poistaa kaiken.
- Salasanat `password_hash`, istuntotunnisteista tallennetaan vain sha256, kirjautumiselle ja rekisteröinnille nopeusrajoitus.

# BarShift Hub (barshift-server)

Keskuspalvelin kahteen asiaan: **julkinen tapahtumakalenteri** ja **keikkatyön välitys baarien välillä**.
Baarit ajavat omaa [barshift-client](https://github.com/raptaqua/barshift-client)-asennustaan (oma kanta, ei muita baareja); keskus ei koskaan sisällä baarin sisäistä dataa.

Rajapinta ja tietoturvaperiaatteet: [API.md](API.md).

## Asennus
```
cp config.example.php config.php      # täytä tietokanta
php bin/install.php                   # luo taulut
php bin/keygen.php                    # baarin avainpari (yksityinen avain baarin asennukseen)
php bin/add_pub.php baari-a "Baari A" "Turku" <public_key>
php bin/add_pub.php --suspend baari-a # estä baari
```
Web-juuri on `public/` (kaikki pyynnöt `public/index.php`:lle). Cron päivittäin: `php bin/cleanup.php`.

## Testit
`TEST_DB_HOST=localhost bash tests/run.sh` (vaatii php + mysqli + sodium, MariaDB, node 18+; testikanta TYHJENNETÄÄN).

## Tietoturva lyhyesti
- Baarin pyynnöt allekirjoitetaan Ed25519:llä (+ aikaleima ja kertakäyttöinen nonce); keskus ei kutsu baareja koskaan.
- Julkaistaan vain julkiset kentät; keikkatyöntekijän yhteystiedot paljastuvat baarille vasta hyväksynnässä; tilin poisto poistaa kaiken.
- Salasanat `password_hash`, istuntotunnisteista tallennetaan vain sha256, kirjautumiselle ja rekisteröinnille nopeusrajoitus.

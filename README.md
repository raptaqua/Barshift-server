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

## Julkinen kalenteri (jaettava)
Kalenteri on hubin juuriosoitteessa (`https://sivu.fi/hub/`): lista-, kuukausi- ja karttanäkymä (OpenStreetMap), haku (myös teeman nimellä), aikavälit (kaikki tulevat / 7 päivää / viikonloppu / 30 päivää), kaupunki- ja teemasuodatus, järjestys (päivän, teeman tai baarin mukaan), tapahtuman tiedot ja "Lisää kalenteriin" (.ics). Osoitteeseen voi lisätä valmiin näkymän: `?city=Turku`, `?type=music,quiz`, `?q=haku`, `?view=cal|map`, `?range=7|weekend|30`, `?sort=theme|pub`. Kartalle tarvitaan baarin sijainti: baarin sovellus lähettää sen julkisesta profiilista (osoite + koordinaatit) tai sen voi syöttää hallintasivulla (Baarit → Muokkaa). Upotus: `<iframe src="https://sivu.fi/hub/?embed=1" style="width:100%;height:700px;border:0"></iframe>` (`embed=1` piilottaa otsikon). Koneluettava syöte: `/api/events`.

## Tilastot
Hallintasivun *Tilastot*-välilehti näyttää: julkisen kalenterin avaukset (päivittäin, uniikit kävijät), tapahtuman avaukset, linkin ("Lisätiedot ja liput") klikkaukset, kalenteriin lisäykset ja suosituimmat tapahtumat; lisäksi yhteenvedon (baarit, tapahtumat, keikkavuorot, hakemukset) ja baarikohtaiset luvut (tapahtumat, keikkavuorot avoimina/täytettyinä, hakemukset vastaanotettu/lähetetty). Laskuri on nimetön: IP-osoitteita ja evästeitä ei tallenneta, uniikit kävijät lasketaan päivittäin vaihtuvalla tiivisteellä, joka poistuu kahdessa vuorokaudessa, ja botit ohitetaan. Päivitä `php bin/install.php`, jotta tilastotaulut syntyvät.

## Hallintasivu
Luo hallintatunnus: `php bin/admin.php create <tunnus>` ja kirjaudu osoitteessa `/admin`. Sivulta: baarien lisäys (palvelin luo kertakäyttöisen liitoskoodin; baari liittää itsensä koodilla client-sovelluksen hallinnasta, ja baarin yksityinen avain pysyy aina clientissa), esto/aktivointi, uusi liitoskoodi (avaimen vaihto), tapahtumien ja keikkavuorojen poisto, keikkatyöläisten hallinta, **Tilastot**-välilehti ja asetukset (sivuston nimi, kalenterin pituus, kalenteri ja rekisteröinti päälle/pois).

## Kartta
Kartta käyttää oletuksena OpenStreetMapin ilmaisia karttapalikoita. Ne vaativat Referer-otsakkeen (hub lähettää sen) ja rajoittavat runsasta käyttöä: jos kartassa lukee *Access blocked*, vaihda oma karttapalvelu hallinnassa (Asetukset → Karttapalvelun osoite, esim. MapTiler tai Stadia; osoite sisältää `{z}/{x}/{y}`).

## Asennuspolku
Web-juuri voi olla `public/` (`.htaccess` ohjaa pyynnöt `index.php`:lle) tai repon juuri (juuren `index.php` + `.htaccess`). Alihakemisto (esim. `https://sivu.fi/hub/`) toimii: asennuspolku tunnistetaan automaattisesti tai asetetaan `config.php`:ssä (`'base_path' => '/hub'`). Baarin `hub.url` on silloin `https://sivu.fi/hub`.

## Testit
`TEST_DB_HOST=localhost bash tests/run.sh` (vaatii php + mysqli + sodium, MariaDB, node 18+; testikanta TYHJENNETÄÄN).

## Tietoturva lyhyesti
- Baarin pyynnöt allekirjoitetaan Ed25519:llä (+ aikaleima ja kertakäyttöinen nonce); keskus ei kutsu baareja koskaan.
- Julkaistaan vain julkiset kentät; keikkatyöntekijän yhteystiedot paljastuvat baarille vasta hyväksynnässä; tilin poisto poistaa kaiken.
- Salasanat `password_hash`, istuntotunnisteista tallennetaan vain sha256, kirjautumiselle ja rekisteröinnille nopeusrajoitus.

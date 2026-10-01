# BarShift Hub – rajapinta

Keskuspalvelin hoitaa **vain** kahta asiaa: julkista tapahtumakalenteria ja baarien välistä keikkatyön välitystä.
Baarien omat tiedot (työntekijät, tunnit, vuorot, kassat) eivät koskaan tule tänne.

## Periaatteet
1. **Vain työntö (push).** Baari lähettää keskukseen vain sen, minkä se itse julkaisee. Keskus ei koskaan kutsu baaria eikä pyydä siltä dataa. Baari hakee (poll) omat hakemuksensa keskuksesta.
2. **Tietojen minimointi.** Tapahtumasta tallennetaan vain julkiset kentät, avoimesta vuorosta vain aika, rooli ja palkkateksti. Henkilötietoja ei lähetetä baarilta keskukseen.
3. **Keikkatyöntekijä hallitsee omaa tietoaan.** Profiili on työntekijän oma, vapaaehtoinen. Baari näkee hakijan nimen, taidot ja viestin vasta hakemuksen jälkeen; yhteystiedot (sähköposti, puhelin) vasta kun baari hyväksyy hakemuksen. Tilin voi poistaa (`DELETE /v1/me`), jolloin myös hakemukset poistuvat.
4. **Allekirjoitetut pyynnöt.** Jokainen baarin pyyntö allekirjoitetaan baarin Ed25519-avaimella. Avaimen voi kumota (`status = suspended`).

## Baarin liittäminen
Keskuksen ylläpitäjä lisää baarin hallintasivulta ja saa kertakäyttöisen **liitoskoodin** (voimassa 7 pv). Baarin client luo itse Ed25519-avainparin ja rekisteröi julkisen avaimen:

`POST /v1/pair` (ei allekirjoitusta) runko `{code, public_key}` (base64, 32 tavua) → `{success, slug, name, city}`. Koodi vanhenee käytettäessä. Yksityinen avain ei koskaan poistu baarin asennuksesta. Uusi liitoskoodi vaihtaa avaimen (vanha toimii, kunnes uusi on liitetty).

## Baarin pyyntöjen allekirjoitus
Otsakkeet:

| Otsake | Sisältö |
|---|---|
| `X-Pub` | baarin slug |
| `X-Timestamp` | Unix-aika sekunteina (sallittu ero ±300 s) |
| `X-Nonce` | satunnainen merkkijono (16–64 merkkiä `[A-Za-z0-9_-]`), kertakäyttöinen |
| `X-Signature` | base64(Ed25519-allekirjoitus) |

Allekirjoitettava teksti (UTF-8, rivinvaihto `\n`):

```
METHOD\nPATH_JA_QUERY\nTIMESTAMP\nNONCE\nsha256hex(BODY)
```

`PATH_JA_QUERY` on pyynnön polku query-osineen (esim. `/v1/applications?since_id=3`). Tyhjän rungon sha256 lasketaan tyhjästä merkkijonosta.

## Baarin rajapinta (`/v1`)
Kaikki vaativat allekirjoituksen. Vastaukset ovat JSON.

| Pyyntö | Kuvaus |
|---|---|
| `PUT /v1/events/{external_id}` | Luo/päivitä julkinen tapahtuma. Runko: `{title, date, time_start?, time_end?, description?, type?, price_text?, url?}` |
| `DELETE /v1/events/{external_id}` | Poista tapahtuma |
| `PUT /v1/profile` | Baarin julkinen osoite ja sijainti kartalle. Runko: `{address?, city?, lat?, lng?, website?}` (lat ja lng yhdessä) |
| `PUT /v1/shifts/{external_id}` | Luo/päivitä avoin keikkavuoro. Runko: `{date, time_start, time_end, role?, pay_text?, note?, status?}` (`status`: `open`/`filled`/`cancelled`) |
| `DELETE /v1/shifts/{external_id}` | Poista vuoro (hakemukset poistuvat) |
| `GET /v1/applications?since_id=N` | Hakemukset baarin vuoroihin (id > N). Yhteystiedot vain hyväksytyillä |
| `POST /v1/applications/{id}/decision` | Runko `{decision: "accepted"\|"declined"}`. Hyväksyntä merkitsee vuoron `filled` |

`external_id`: 1–64 merkkiä `[A-Za-z0-9_.-]`, baarin oma tunniste.

## Julkinen rajapinta
| Pyyntö | Kuvaus |
|---|---|
| `GET /api/events?city=&from=&to=&limit=` | Julkiset tapahtumat (mukana `id` tilastointia varten) (ei kirjautumista, CORS auki). Vanha `/public/events` toimii edelleen |
| `POST /api/track` | Kalenterisivun nimetön käyttötilasto: `{t: view\|open\|link\|ics, e?: tapahtuman id}` → 204. Ei evästeitä eikä IP-osoitteita (vain päivittäin vaihtuva tiiviste uniikkien laskentaan, poistuu 2 vrk:ssa); botit ohitetaan |
| `GET /api/config` | Sivuston nimi, alatunniste, kaupungit |

## Keikkatyöntekijän rajapinta (istuntotunniste `Authorization: Bearer <token>`)
| Pyyntö | Kuvaus |
|---|---|
| `POST /v1/workers` | Rekisteröi `{email, name, password, phone?, city?, skills?}` |
| `POST /v1/login` | `{email, password}` → `{token}` |
| `GET /v1/me` / `PUT /v1/me` / `DELETE /v1/me` | Oma profiili / muokkaus / poisto (vaatii `{password}` poistoon) |
| `GET /v1/open_shifts?city=` | Avoimet vuorot |
| `POST /v1/shifts/{shift_id}/apply` | Hae vuoroa `{message?}` |
| `GET /v1/my_applications` | Omat hakemukset |
| `POST /v1/applications/{id}/withdraw` | Peru hakemus |

## Baarien välinen keikkapörssi (allekirjoitettu baaripyyntö)
Baarin työntekijät hakevat toisten baarien avoimia vuoroja omassa BarShift-asennuksessaan. Keskus vain välittää: vuorot ovat julkista tietoa, ja hakijan tiedot kulkevat ainoastaan vuoron tarjonneelle baarille.

| Pyyntö | Kuvaus |
|---|---|
| `GET /v1/feed?city=` | Muiden baarien avoimet vuorot (`id, date, time_start, time_end, role, pay_text, note, updated_at, pub, city`). Oman baarin vuoroja ei palauteta |
| `POST /v1/feed/{shift_id}/apply` | Hae vuoroa: `{ref, name, phone?, email?, skills?, message?}` (vähintään `phone` tai `email`). `ref` on hakijan pysyvä tunniste hakevan baarin päässä (`[A-Za-z0-9_-]{1,64}`); sama `ref` + vuoro = yksi hakemus. Vastaus `{id, status}` |
| `GET /v1/outgoing_applications` | Oman baarin lähettämät hakemukset ja niiden tila (`pending/accepted/declined`, vuoron tiedot, hyväksytyssä myös tarjoavan baarin osoite) |
| `POST /v1/outgoing_applications/{id}/withdraw` | Peru odottava hakemus |

Vuoron tarjonnut baari näkee hakemukset samassa `GET /v1/applications`-listassa (`from_pub` = hakijan baari); yhteystiedot paljastuvat vasta hyväksynnän jälkeen.

Virheet: `{ "error": "teksti" }` ja HTTP-statuskoodi.

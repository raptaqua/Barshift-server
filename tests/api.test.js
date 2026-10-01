// Keskuspalvelimen testit: allekirjoitus, replay, tapahtumat, vuorot, hakemukset, yksityisyys
const assert = require('assert'), crypto = require('crypto'), { execFileSync } = require('child_process');
const BASE = process.env.HUB_BASE, SUB = process.env.HUB_SUB;
const kp = () => { const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519'); return { pub: publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64'), priv: privateKey }; };
function addPub(slug, name, city, pub) { execFileSync('php', ['bin/add_pub.php', slug, name, city, pub], { env: process.env }); }
async function signed(k, slug, method, path, body, over = {}) {
    const raw = body === undefined ? '' : JSON.stringify(body), ts = String(over.ts ?? Math.floor(Date.now() / 1000)), nonce = over.nonce ?? crypto.randomBytes(12).toString('hex');
    const msg = `${method}\n${path}\n${ts}\n${nonce}\n${crypto.createHash('sha256').update(raw).digest('hex')}`;
    const sig = crypto.sign(null, Buffer.from(msg), (over.key ?? k).priv).toString('base64');
    const r = await fetch(BASE + path, { method, body: raw || undefined, headers: { 'X-Pub': slug, 'X-Timestamp': ts, 'X-Nonce': nonce, 'X-Signature': sig, 'Content-Type': 'application/json' } });
    return { status: r.status, json: await r.json().catch(() => ({})) };
}
async function plain(method, path, body, token) {
    const r = await fetch(BASE + path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
    return { status: r.status, json: await r.json().catch(() => ({})) };
}
let pass = 0, failN = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { failN++; console.log('  FAIL', name, '\n      ', String(e.message).split('\n').slice(0, 3).join(' ⏎ ')); } }
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

(async () => {
    const A = kp(), B = kp(), evil = kp();
    addPub('baari-a', 'Baari A', 'Turku', A.pub); addPub('baari-b', 'Baari B', 'Helsinki', B.pub);

    await t('allekirjoittamaton pyyntö hylätään', async () => { const r = await plain('PUT', '/v1/events/x1', { title: 'X', date: day(5) }); assert.strictEqual(r.status, 401); });
    await t('väärällä avaimella allekirjoitettu hylätään', async () => { const r = await signed(A, 'baari-a', 'PUT', '/v1/events/e1', { title: 'X', date: day(5) }, { key: evil }); assert.strictEqual(r.status, 401); });
    await t('vanha aikaleima hylätään', async () => { const r = await signed(A, 'baari-a', 'PUT', '/v1/events/e1', { title: 'X', date: day(5) }, { ts: Math.floor(Date.now() / 1000) - 3600 }); assert.strictEqual(r.status, 401); });
    await t('nonce toimii vain kerran (replay)', async () => {
        const n = crypto.randomBytes(12).toString('hex');
        assert.strictEqual((await signed(A, 'baari-a', 'PUT', '/v1/events/e1', { title: 'Keikka', date: day(5) }, { nonce: n })).status, 200);
        assert.strictEqual((await signed(A, 'baari-a', 'PUT', '/v1/events/e1', { title: 'Keikka', date: day(5) }, { nonce: n })).status, 401);
    });
    await t('toisen baarin nimellä ei voi muokata (allekirjoitus sitoo baariin)', async () => { const r = await signed(A, 'baari-b', 'PUT', '/v1/events/e1', { title: 'Väärä', date: day(5) }); assert.strictEqual(r.status, 401); });
    await t('runkoa ei voi vaihtaa allekirjoituksen jälkeen', async () => {
        const raw = JSON.stringify({ title: 'Alkup', date: day(5) }), ts = String(Math.floor(Date.now() / 1000)), nonce = crypto.randomBytes(12).toString('hex');
        const msg = `PUT\n/v1/events/e2\n${ts}\n${nonce}\n${crypto.createHash('sha256').update(raw).digest('hex')}`;
        const r = await fetch(BASE + '/v1/events/e2', { method: 'PUT', body: JSON.stringify({ title: 'Muutettu', date: day(5) }), headers: { 'X-Pub': 'baari-a', 'X-Timestamp': ts, 'X-Nonce': nonce, 'X-Signature': crypto.sign(null, Buffer.from(msg), A.priv).toString('base64') } });
        assert.strictEqual(r.status, 401);
    });
    await t('tapahtumavalidointi', async () => {
        assert.strictEqual((await signed(A, 'baari-a', 'PUT', '/v1/events/e3', { title: '', date: day(5) })).status, 400);
        assert.strictEqual((await signed(A, 'baari-a', 'PUT', '/v1/events/e3', { title: 'T', date: '2026-13-45' })).status, 400);
        assert.strictEqual((await signed(A, 'baari-a', 'PUT', '/v1/events/e3', { title: 'T', date: day(5), url: 'javascript:alert(1)' })).status, 400);
        assert.strictEqual((await signed(A, 'baari-a', 'PUT', '/v1/events/e3', { title: 'T'.repeat(200), date: day(5) })).status, 400);
        assert.strictEqual((await signed(A, 'baari-a', 'PUT', '/v1/events/a%20b', { title: 'T', date: day(5) })).status, 400);
    });
    await t('julkinen kalenteri: tapahtumat näkyvät, vain julkiset kentät, kaupunkisuodatus', async () => {
        assert.strictEqual((await signed(B, 'baari-b', 'PUT', '/v1/events/b1', { title: 'Visa', date: day(6), time_start: '19:00', price_text: '5 €', url: 'https://b.example/visa' })).status, 200);
        const all = (await plain('GET', '/public/events')).json.events; assert.ok(all.length >= 2);
        const ev = all.find(e => e.title === 'Visa'); assert.strictEqual(ev.pub, 'Baari B'); assert.strictEqual(ev.city, 'Helsinki');
        assert.deepStrictEqual(Object.keys(ev).sort(), ['city', 'date', 'description', 'price_text', 'pub', 'time_end', 'time_start', 'title', 'type', 'url']);
        const tku = (await plain('GET', '/public/events?city=Turku')).json.events; assert.ok(tku.length && tku.every(e => e.city === 'Turku'));
    });
    await t('tapahtuma päivittyy ja poistuu; toinen baari ei voi poistaa', async () => {
        assert.strictEqual((await signed(A, 'baari-a', 'PUT', '/v1/events/e1', { title: 'Päivitetty', date: day(5) })).status, 200);
        assert.ok((await plain('GET', '/public/events')).json.events.some(e => e.title === 'Päivitetty'));
        await signed(B, 'baari-b', 'DELETE', '/v1/events/e1');   // B:n e1 ei ole olemassa -> ei vaikutusta A:han
        assert.ok((await plain('GET', '/public/events')).json.events.some(e => e.title === 'Päivitetty'));
        assert.strictEqual((await signed(A, 'baari-a', 'DELETE', '/v1/events/e1')).status, 200);
        assert.ok(!(await plain('GET', '/public/events')).json.events.some(e => e.title === 'Päivitetty'));
    });

    let w1, w2, shiftId;
    await t('työntekijän rekisteröinti, kirjautuminen ja salasanasäännöt', async () => {
        assert.strictEqual((await plain('POST', '/v1/workers', { email: 'a@x.test', name: 'Aino Keikka', password: 'lyhyt' })).status, 400);
        assert.strictEqual((await plain('POST', '/v1/workers', { email: 'a@x.test', name: 'Aino Keikka', password: 'pitkasalasana1', phone: '0401234567', city: 'Turku', skills: 'baarimestari' })).status, 201);
        assert.strictEqual((await plain('POST', '/v1/workers', { email: 'a@x.test', name: 'Toinen', password: 'pitkasalasana1' })).status, 409);
        assert.strictEqual((await plain('POST', '/v1/login', { email: 'a@x.test', password: 'vaara-salasana' })).status, 401);
        w1 = (await plain('POST', '/v1/login', { email: 'a@x.test', password: 'pitkasalasana1' })).json.token; assert.match(w1, /^[0-9a-f]{64}$/);
        await plain('POST', '/v1/workers', { email: 'b@x.test', name: 'Ben Toinen', password: 'pitkasalasana2' });
        w2 = (await plain('POST', '/v1/login', { email: 'b@x.test', password: 'pitkasalasana2' })).json.token;
    });
    await t('avoimet vuorot vaativat kirjautumisen; baari julkaisee vuoron', async () => {
        assert.strictEqual((await plain('GET', '/v1/open_shifts')).status, 401);
        assert.strictEqual((await signed(A, 'baari-a', 'PUT', '/v1/shifts/s1', { date: day(4), time_start: '17:00', time_end: '23:00', role: 'Baarimestari', pay_text: '16 €/h' })).status, 200);
        const l = (await plain('GET', '/v1/open_shifts', undefined, w1)).json.shifts; const s = l.find(x => x.pub === 'Baari A'); assert.ok(s); shiftId = s.id;
        assert.deepStrictEqual(Object.keys(s).sort(), ['city', 'date', 'id', 'note', 'pay_text', 'pub', 'role', 'time_end', 'time_start']);
    });
    await t('hakeminen: yhteystiedot piilossa kunnes hyväksytty', async () => {
        assert.strictEqual((await plain('POST', `/v1/shifts/${shiftId}/apply`, { message: 'Voin tulla' }, w1)).status, 201);
        assert.strictEqual((await plain('POST', `/v1/shifts/${shiftId}/apply`, { message: 'Voin tulla' }, w2)).status, 201);
        const apps = (await signed(A, 'baari-a', 'GET', '/v1/applications?since_id=0')).json.applications; assert.strictEqual(apps.length, 2);
        const a1 = apps.find(a => a.name === 'Aino Keikka'); assert.strictEqual(a1.email, null); assert.strictEqual(a1.phone, null); assert.strictEqual(a1.message, 'Voin tulla');
        assert.strictEqual((await signed(B, 'baari-b', 'GET', '/v1/applications?since_id=0')).json.applications.length, 0, 'toinen baari näkee hakemuksia');
        assert.strictEqual((await signed(B, 'baari-b', 'POST', `/v1/applications/${a1.id}/decision`, { decision: 'accepted' })).status, 404, 'toinen baari päätti hakemuksesta');
        assert.strictEqual((await signed(A, 'baari-a', 'POST', `/v1/applications/${a1.id}/decision`, { decision: 'accepted' })).status, 200);
        assert.strictEqual((await signed(A, 'baari-a', 'POST', `/v1/applications/${a1.id}/decision`, { decision: 'declined' })).status, 409);
        const after = (await signed(A, 'baari-a', 'GET', '/v1/applications?since_id=0')).json.applications;
        const acc = after.find(a => a.id === a1.id); assert.strictEqual(acc.email, 'a@x.test'); assert.strictEqual(acc.phone, '0401234567');
        const other = after.find(a => a.name === 'Ben Toinen'); assert.strictEqual(other.status, 'declined'); assert.strictEqual(other.email, null);
    });
    await t('täytetty vuoro ei ole enää haettavissa; omat hakemukset', async () => {
        assert.ok(!(await plain('GET', '/v1/open_shifts', undefined, w1)).json.shifts.some(s => s.id === shiftId));
        assert.strictEqual((await plain('POST', `/v1/shifts/${shiftId}/apply`, {}, w1)).status, 404);
        const mine = (await plain('GET', '/v1/my_applications', undefined, w1)).json.applications; assert.strictEqual(mine.length, 1); assert.strictEqual(mine[0].status, 'accepted');
        assert.strictEqual((await plain('GET', '/v1/my_applications', undefined, w2)).json.applications[0].status, 'declined');
    });
    await t('peruminen, profiilin muokkaus ja tilin poisto poistaa hakemukset', async () => {
        assert.strictEqual((await plain('PUT', '/v1/me', { skills: 'baarimestari, tarjoilija' }, w1)).status, 200);
        assert.strictEqual((await plain('GET', '/v1/me', undefined, w1)).json.skills, 'baarimestari, tarjoilija');
        assert.strictEqual((await plain('DELETE', '/v1/me', { password: 'vaara' }, w1)).status, 403);
        assert.strictEqual((await plain('DELETE', '/v1/me', { password: 'pitkasalasana1' }, w1)).status, 200);
        assert.strictEqual((await plain('GET', '/v1/me', undefined, w1)).status, 401, 'istunto toimii tilin poiston jälkeen');
        const apps = (await signed(A, 'baari-a', 'GET', '/v1/applications?since_id=0')).json.applications; assert.ok(!apps.some(a => a.name === 'Aino Keikka'), 'poistetun käyttäjän tiedot jäivät');
    });
    await t('alihakemistoasennus (base_path): allekirjoitus lasketaan polulle ilman asennuspolkua', async () => {
        const raw = JSON.stringify({ title: 'Alihakemisto', date: day(9) }), ts = String(Math.floor(Date.now() / 1000)), nonce = crypto.randomBytes(12).toString('hex');
        const msg = `PUT\n/v1/events/sub1\n${ts}\n${nonce}\n${crypto.createHash('sha256').update(raw).digest('hex')}`;
        const r = await fetch(SUB + '/hub/v1/events/sub1', { method: 'PUT', body: raw, headers: { 'X-Pub': 'baari-a', 'X-Timestamp': ts, 'X-Nonce': nonce, 'X-Signature': crypto.sign(null, Buffer.from(msg), A.priv).toString('base64') } });
        assert.strictEqual(r.status, 200, await r.text());
        const pub = await (await fetch(SUB + '/hub/public/events')).json(); assert.ok(pub.events.some(e => e.title === 'Alihakemisto'));
        assert.strictEqual((await fetch(SUB + '/hub/')).status, 200);
    });
    await t('hallintasivu: kirjautuminen, CSRF-otsake, baarin lisäys avaimineen, asetukset', async () => {
        execFileSync('php', ['bin/admin.php', 'create', 'tester'], { input: 'testipassword12\n', env: process.env });
        const jar = {};
        const call = async (method, path, body, hdr = { 'X-Hub-Admin': '1' }) => {
            const r = await fetch(BASE + '/admin/api' + path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...hdr, ...(jar.c ? { Cookie: jar.c } : {}) } });
            const sc = r.headers.get('set-cookie'); if (sc) jar.c = sc.split(';')[0];
            return { status: r.status, json: await r.json().catch(() => ({})) };
        };
        assert.strictEqual((await call('GET', '/overview')).status, 401);
        assert.strictEqual((await call('POST', '/login', { username: 'tester', password: 'testipassword12' }, {})).status, 403, 'CSRF-otsakkeeton pyyntö meni läpi');
        assert.strictEqual((await call('POST', '/login', { username: 'tester', password: 'väärä-salasana-1' })).status, 401);
        assert.strictEqual((await call('POST', '/login', { username: 'tester', password: 'testipassword12' })).status, 200);
        assert.ok((await call('GET', '/overview')).json.pubs >= 2);
        const add = await call('POST', '/pubs', { slug: 'uusi-baari', name: 'Uusi Baari', city: 'Oulu' }); assert.strictEqual(add.status, 201);
        assert.match(add.json.code, /^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/); assert.ok(add.json.url);
        assert.ok(!JSON.stringify(add.json).includes('private'), 'palvelin ei saa tuntea baarin yksityistä avainta');
        // odottaa liittämistä: ei pääse sisään, ei näy kalenterissa
        const k2 = kp();
        assert.strictEqual((await signed(k2, 'uusi-baari', 'PUT', '/v1/events/u1', { title: 'Ennen liittämistä', date: day(8) })).status, 401);
        assert.strictEqual((await plain('POST', '/v1/pair', { code: 'AAAAA-AAAAA-AAAAA-AAAAA', public_key: k2.pub })).status, 404, 'väärä koodi kelpasi');
        assert.strictEqual((await plain('POST', '/v1/pair', { code: add.json.code, public_key: 'ei-avain' })).status, 400);
        const paired = await plain('POST', '/v1/pair', { code: add.json.code.toLowerCase(), public_key: k2.pub }); assert.strictEqual(paired.status, 200, JSON.stringify(paired.json)); assert.strictEqual(paired.json.slug, 'uusi-baari');
        assert.strictEqual((await plain('POST', '/v1/pair', { code: add.json.code, public_key: kp().pub })).status, 404, 'koodi toimi kahdesti');
        assert.strictEqual((await signed(k2, 'uusi-baari', 'PUT', '/v1/events/u1', { title: 'Avaimella', date: day(8) })).status, 200, 'liitetty avain ei kelvannut');
        assert.strictEqual((await call('POST', '/pubs', { slug: 'uusi-baari', name: 'X' })).status, 409);
        assert.strictEqual((await call('POST', '/pubs', { slug: 'Väärä Tunnus', name: 'X' })).status, 400);
        const list = (await call('GET', '/pubs')).json.pubs; const nb = list.find(p => p.slug === 'uusi-baari'); assert.ok(nb.last_seen_at); assert.strictEqual(nb.status, 'active'); assert.ok(nb.paired);
        // uusi liitoskoodi vaihtaa avaimen: vanha toimii kunnes uusi liitetään, sen jälkeen ei
        const rot = await call('POST', `/pubs/${nb.id}/pairing_code`); assert.strictEqual(rot.status, 200);
        assert.strictEqual((await signed(k2, 'uusi-baari', 'PUT', '/v1/events/u1', { title: 'Vielä vanha', date: day(8) })).status, 200);
        const k3 = kp(); assert.strictEqual((await plain('POST', '/v1/pair', { code: rot.json.code, public_key: k3.pub })).status, 200);
        assert.strictEqual((await signed(k2, 'uusi-baari', 'PUT', '/v1/events/u1', { title: 'Vanha avain', date: day(8) })).status, 401, 'vanha avain toimii yhä');
        assert.strictEqual((await signed(k3, 'uusi-baari', 'PUT', '/v1/events/u1', { title: 'Avaimella', date: day(8) })).status, 200);
        // asetukset
        assert.strictEqual((await call('PUT', '/settings', { calendar_days_ahead: 3 })).status, 400);
        assert.strictEqual((await call('PUT', '/settings', { site_name: 'Testikalenteri', calendar_days_ahead: 30, footer_text: 'Alatunniste' })).status, 200);
        assert.strictEqual((await plain('GET', '/public/config')).json.site_name, 'Testikalenteri');
        assert.ok(!(await plain('GET', '/public/events')).json.events.some(e => e.date > day(31)), 'päivärajaus ei toimi');
        assert.ok((await call('PUT', '/settings', { worker_registration: false })).json.success);
        assert.strictEqual((await plain('POST', '/v1/workers', { email: 'suljettu@x.test', name: 'Suljettu', password: 'pitkasalasana1' })).status, 403);
        assert.ok((await call('PUT', '/settings', { worker_registration: true, calendar_days_ahead: 180 })).json.success);
        // sisällön hallinta
        const evs = (await call('GET', '/events')).json.events; const ev = evs.find(e => e.title === 'Avaimella'); assert.ok(ev);
        assert.strictEqual((await call('DELETE', '/events/' + ev.id)).status, 200);
        assert.ok(!(await call('GET', '/events')).json.events.some(e => e.title === 'Avaimella'));
        assert.strictEqual((await call('POST', '/password', { current: 'väärä', new: 'uusisalasana123' })).status, 403);
        assert.strictEqual((await call('POST', '/logout')).status, 200); assert.strictEqual((await call('GET', '/overview')).status, 401);
        assert.strictEqual((await fetch(BASE + '/admin')).status, 200); assert.strictEqual((await fetch(BASE + '/admin.js')).status, 200);
    });
    await t('estetty baari ei pääse sisään eikä näy kalenterissa', async () => {
        execFileSync('php', ['bin/add_pub.php', '--suspend', 'baari-b'], { env: process.env });
        assert.strictEqual((await signed(B, 'baari-b', 'PUT', '/v1/events/b2', { title: 'Y', date: day(7) })).status, 401);
        assert.ok(!(await plain('GET', '/public/events')).json.events.some(e => e.pub === 'Baari B'));
    });
    await t('kirjautumisyritykset rajoitettu (429)', async () => {
        let last = 0; for (let i = 0; i < 10; i++) last = (await plain('POST', '/v1/login', { email: 'ei@x.test', password: 'x' })).status; assert.strictEqual(last, 429);
    });
    await t('julkinen sivu ja tuntematon polku', async () => {
        assert.strictEqual((await fetch(BASE + '/')).status, 200); assert.strictEqual((await plain('GET', '/nope')).status, 404);
    });
    console.log(`\n${pass} läpi, ${failN} epäonnistui`); process.exit(failN ? 1 : 0);
})();

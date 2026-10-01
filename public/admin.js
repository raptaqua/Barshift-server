// Hallintasivu. Kaikki sisältö rakennetaan DOM-metodeilla (textContent), ei innerHTML:ää käyttäjädatalle.
const BASE = location.pathname.replace(/\/admin(\.html)?$/, '');
const app = document.getElementById('app');
function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
}
async function api(method, path, body) {
    const r = await fetch(BASE + '/admin/api' + path, { method, headers: { 'X-Hub-Admin': '1', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { throw new Error('Palvelin vastasi virheellisesti (' + r.status + '): ' + t.slice(0, 100)); }
    if (r.status === 401 && path !== '/login') { showLogin(); throw new Error(j.error); }
    if (!r.ok) throw new Error(j.error || 'Virhe ' + r.status);
    return j;
}
function msg(box, text, ok) { box.textContent = text; box.className = ok ? 'ok' : 'err'; }
let tab = 'overview';

function showLogin() {
    const err = h('div', { class: 'err' }), u = h('input', { placeholder: 'Tunnus', autocomplete: 'username' }), p = h('input', { type: 'password', placeholder: 'Salasana', autocomplete: 'current-password' });
    const go = async () => { try { await api('POST', '/login', { username: u.value, password: p.value }); start(); } catch (e) { msg(err, e.message); } };
    p.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    app.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Kirjaudu'), h('div', { class: 'row' }, u, p, h('button', { onclick: go }, 'Kirjaudu')), err));
}
async function start() {
    try { await api('GET', '/me'); } catch (e) { return; }
    const names = { overview: 'Yhteenveto', stats: 'Tilastot', pubs: 'Baarit', events: 'Tapahtumat', shifts: 'Keikkavuorot', workers: 'Keikkatyöläiset', settings: 'Asetukset' };
    const tabs = h('div', { class: 'tabs' }, Object.entries(names).map(([k, v]) => h('button', { class: k === tab ? 'on' : '', onclick: () => { tab = k; start(); } }, v)),
        h('a', { href: BASE + '/', target: '_blank', rel: 'noopener' }, h('button', { class: 'ghost' }, 'Avaa julkinen kalenteri ↗')),
        h('button', { class: 'ghost', onclick: async () => { await api('POST', '/logout'); showLogin(); } }, 'Kirjaudu ulos'));
    const body = h('div', {}); app.replaceChildren(tabs, body);
    try { await views[tab](body); } catch (e) { body.append(h('div', { class: 'err' }, e.message)); }
}
function table(cols, rows, actions) {
    return h('div', { class: 'card' }, h('table', {}, h('tr', {}, cols.map(c => h('th', {}, c[0])), actions ? h('th') : null),
        rows.map(r => h('tr', {}, cols.map(c => h('td', {}, c[1](r))), actions ? h('td', {}, actions(r)) : null))));
}
const views = {
    async overview(b) {
        const o = await api('GET', '/overview');
        const st = (n, l) => h('div', { class: 'card stat' }, h('b', {}, o[n]), h('span', { class: 'muted' }, l));
        const calUrl = location.origin + BASE + '/';
        const copy = (text, btn) => async () => { try { await navigator.clipboard.writeText(text); btn.textContent = 'Kopioitu ✓'; } catch (e) { prompt('Kopioi osoite', text); } };
        const b1 = h('button', { class: 'ghost' }, 'Kopioi osoite'); b1.addEventListener('click', copy(calUrl, b1));
        const embed = '<iframe src="' + calUrl + '?embed=1" style="width:100%;height:700px;border:0" title="Tapahtumakalenteri"></iframe>';
        const b2 = h('button', { class: 'ghost' }, 'Kopioi upotuskoodi'); b2.addEventListener('click', copy(embed, b2));
        b.append(h('div', { class: 'card calcard' }, h('h2', {}, 'Julkinen tapahtumakalenteri – jaa tämä'), h('p', { class: 'muted' }, 'Tämä on sivu, jota kävijät käyttävät: kaikkien liitettyjen baarien julkiset tapahtumat yhdessä paikassa. Jaa osoite missä tahansa tai upota kalenteri omalle sivullesi. Osoitteeseen voi lisätä valmiin suodatuksen, esim. ?city=Turku tai ?type=music, ja ?embed=1 piilottaa otsikon upotuksessa.'),
            h('div', { class: 'row' }, h('a', { href: calUrl, target: '_blank', rel: 'noopener' }, calUrl), h('a', { href: calUrl, target: '_blank', rel: 'noopener' }, h('button', {}, 'Avaa kalenteri')), b1, b2),
            h('p', { class: 'muted' }, 'Tapahtumat myös koneluettavana (JSON): ', h('a', { href: BASE + '/api/events', target: '_blank', rel: 'noopener' }, calUrl + 'api/events'))));
        b.append(h('div', { class: 'grid' }, st('pubs_active', 'Aktiivista baaria'), st('events', 'Tulevaa tapahtumaa'), st('open_shifts', 'Avointa keikkavuoroa'), st('workers', 'Keikkatyöläistä'), st('pending_applications', 'Käsittelemätöntä hakemusta')));
    },
    async stats(b) {
        let days = Number(sessionStorage.getItem('hubStatDays') || 30);
        const box = h('div', {});
        const num = n => Number(n).toLocaleString('fi-FI');
        const card = (n, l, sub) => h('div', { class: 'card stat' }, h('b', {}, num(n)), h('span', { class: 'muted' }, l), sub ? h('small', { class: 'muted' }, sub) : null);
        async function load() {
            const r = await api('GET', '/stats?days=' + days), o = r.overview, c = r.calendar;
            const range = h('div', { class: 'row' }, [[7, '7 pv'], [30, '30 pv'], [90, '90 pv'], [365, '12 kk']].map(([d, l]) => h('button', { class: d === days ? '' : 'ghost', onclick: () => { days = d; sessionStorage.setItem('hubStatDays', d); load(); } }, l)));
            const max = Math.max(1, ...c.series.map(s => s.views));
            const bars = h('div', { class: 'bars', role: 'img', 'aria-label': 'Kalenterin avaukset päivittäin' }, c.series.map(s => h('div', { class: 'bar', title: s.day + ': ' + s.views + ' avausta, ' + s.uniques + ' kävijää, ' + s.opens + ' tapahtuman avausta, ' + s.links + ' linkin klikkausta' }, (() => { const i = h('i'); i.style.height = Math.round(100 * s.views / max) + '%'; return i; })())));
            box.replaceChildren(
                h('div', { class: 'card' }, h('h2', {}, 'Julkinen kalenteri'), h('p', { class: 'muted' }, 'Nimetön laskuri: IP-osoitteita tai evästeitä ei tallenneta. Kävijä lasketaan kerran päivässä, ja botit jätetään pois. Avaukset lasketaan istunnoittain.'), range,
                    h('div', { class: 'grid' }, card(c.window.views, 'Kalenterin avausta', 'viimeiset ' + days + ' pv, yhteensä ' + num(c.total.views)), card(c.window.uniques, 'Kävijää (päivittäin laskettuna)', 'yhteensä ' + num(c.total.uniques)),
                        card(c.window.opens, 'Tapahtuman avausta', 'yhteensä ' + num(c.total.opens)), card(c.window.links, 'Linkin avausta', 'Lisätiedot ja liput · yhteensä ' + num(c.total.links)), card(c.window.ics, 'Kalenteriin lisäystä', 'yhteensä ' + num(c.total.ics))),
                    h('h3', {}, 'Avaukset päivittäin'), bars, h('div', { class: 'muted axis' }, h('span', {}, c.series[0].day), h('span', {}, c.series[c.series.length - 1].day))),
                h('div', { class: 'card' }, h('h2', {}, 'Suosituimmat tapahtumat'), c.top_events.length ? h('table', {}, h('tr', {}, ['Tapahtuma', 'Baari', 'Pvm', 'Avauksia', 'Linkin klikkauksia', 'Kalenteriin'].map(x => h('th', {}, x))),
                    c.top_events.map(e => h('tr', {}, h('td', {}, e.title), h('td', {}, e.pub), h('td', {}, e.date), h('td', {}, num(e.opens)), h('td', {}, num(e.links)), h('td', {}, num(e.ics))))) : h('p', { class: 'muted' }, 'Ei vielä avauksia.')),
                h('div', { class: 'card' }, h('h2', {}, 'Yhteenveto'), h('div', { class: 'grid' }, card(o.pubs_active, 'Aktiivista baaria', o.pubs_pending ? o.pubs_pending + ' odottaa liittämistä' : null), card(o.events_upcoming, 'Tulevaa tapahtumaa', 'yhteensä ' + num(o.events_total)),
                    card(o.shifts_open, 'Avointa keikkavuoroa', num(o.shifts_total) + ' vuoroa yhteensä, ' + num(o.shifts_filled) + ' täytetty'), card(o.applications_total, 'Hakemusta', o.applications_pending + ' käsittelemättä, ' + o.applications_accepted + ' hyväksytty'),
                    card(o.applications_from_pubs, 'Baarien kautta tullutta hakemusta'), card(o.workers, 'Keikkatyöläistä'))),
                h('div', { class: 'card' }, h('h2', {}, 'Baarikohtaiset luvut'), h('table', {}, h('tr', {}, ['Baari', 'Tapahtumia (tulevat / kaikki)', 'Keikkavuoroja (avoimia / täytetty / kaikki)', 'Hakemuksia vastaanotettu', 'Hakemuksia lähetetty', 'Tapahtumien avauksia', 'Linkin klikkauksia', 'Viimeksi yhteydessä'].map(x => h('th', {}, x))),
                    r.pubs.map(p => h('tr', {}, h('td', {}, p.name + (p.city ? ', ' + p.city : '') + (p.status !== 'active' ? ' (' + p.status + ')' : '')), h('td', {}, p.events_upcoming + ' / ' + p.events_total), h('td', {}, p.shifts_open + ' / ' + p.shifts_filled + ' / ' + p.shifts_total),
                        h('td', {}, p.applications_received), h('td', {}, p.applications_sent), h('td', {}, num(p.event_opens)), h('td', {}, num(p.event_links)), h('td', {}, p.last_seen_at || 'ei vielä'))))));
        }
        b.append(box); await load();
    },
    async pubs(b) {
        const out = h('div', {});
        const slug = h('input', { placeholder: 'tunnus (esim. oma-baari)' }), name = h('input', { placeholder: 'Baarin nimi' }), city = h('input', { placeholder: 'Kaupunki' }), err = h('div', { class: 'err' });
        const add = async () => {
            try { const r = await api('POST', '/pubs', { slug: slug.value, name: name.value, city: city.value }); showCode(out, r); slug.value = name.value = city.value = ''; msg(err, ''); loadList(); } catch (e) { msg(err, e.message); }
        };
        b.append(h('div', { class: 'card' }, h('h2', {}, 'Lisää baari'), h('p', { class: 'muted' }, 'Palvelin luo baarille kertakäyttöisen liitoskoodin. Anna koodi baarin ylläpitäjälle: hän liittää baarin tähän palvelimeen client-sovelluksensa hallinnasta (Baari → Asetukset → Keskuspalvelin). Koodia ei tarvitse kirjoittaa mihinkään tiedostoon.'), h('div', { class: 'row' }, slug, name, city, h('button', { onclick: add }, 'Lisää')), err), out);
        const listBox = h('div', {}); b.append(listBox);
        async function loadList() {
            const pubs = (await api('GET', '/pubs')).pubs;
            listBox.replaceChildren(table([['Baari', r => r.name + ' (' + r.slug + ')'], ['Kaupunki', r => r.city], ['Sijainti', r => r.lat != null ? '📍 kartalla' : '–'], ['Tila', r => r.status === 'pending' ? 'Odottaa liittämistä' : (r.status === 'active' ? 'Aktiivinen' : 'Estetty')], ['Viimeksi yhteydessä', r => r.last_seen_at || 'ei vielä'], ['Tapahtumia', r => r.events], ['Avoimia vuoroja', r => r.open_shifts]], pubs, r => h('div', { class: 'row' },
                r.status !== 'pending' ? h('button', { class: 'ghost', onclick: async () => { await api('PUT', '/pubs/' + r.id, { name: r.name, city: r.city, status: r.status === 'active' ? 'suspended' : 'active' }); loadList(); } }, r.status === 'active' ? 'Estä' : 'Aktivoi') : null,
                h('button', { class: 'ghost', onclick: () => editPub(out, r, loadList) }, 'Muokkaa'),
                h('button', { class: 'ghost', onclick: async () => showCode(out, await api('POST', '/pubs/' + r.id + '/pairing_code')) }, r.paired ? 'Uusi liitoskoodi' : 'Näytä liitoskoodi'),
                h('button', { class: 'danger', onclick: async () => { if (confirm('Poistetaanko baari ja kaikki sen tapahtumat ja vuorot?')) { await api('DELETE', '/pubs/' + r.id); loadList(); } } }, 'Poista'))));
        }
        await loadList();
    },
    async events(b) {
        b.append(table([['Pvm', r => r.date], ['Tapahtuma', r => r.title], ['Baari', r => r.pub + (r.city ? ', ' + r.city : '')], ['Hinta', r => r.price_text || '']], (await api('GET', '/events')).events,
            r => h('button', { class: 'danger', onclick: async () => { if (confirm('Poistetaanko tapahtuma? Baari voi lähettää sen uudelleen.')) { await api('DELETE', '/events/' + r.id); start(); } } }, 'Poista')));
    },
    async shifts(b) {
        b.append(table([['Pvm', r => r.date], ['Aika', r => r.time_start.slice(0, 5) + '–' + r.time_end.slice(0, 5)], ['Rooli', r => r.role || ''], ['Baari', r => r.pub], ['Tila', r => r.status], ['Hakemuksia', r => r.applications]], (await api('GET', '/shifts')).shifts,
            r => h('button', { class: 'danger', onclick: async () => { if (confirm('Poistetaanko vuoro ja sen hakemukset?')) { await api('DELETE', '/shifts/' + r.id); start(); } } }, 'Poista')));
    },
    async workers(b) {
        b.append(table([['Nimi', r => r.name], ['Sähköposti', r => r.email], ['Kaupunki', r => r.city], ['Taidot', r => r.skills], ['Hakemuksia', r => r.applications], ['Rekisteröitynyt', r => r.created_at]], (await api('GET', '/workers')).workers,
            r => h('button', { class: 'danger', onclick: async () => { if (confirm('Poistetaanko tili ja sen hakemukset?')) { await api('DELETE', '/workers/' + r.id); start(); } } }, 'Poista')));
    },
    async settings(b) {
        const s = (await api('GET', '/settings')).settings, st = h('div', {});
        const f = { site_name: h('input', { value: s.site_name, maxlength: 80 }), days: h('input', { type: 'number', min: 7, max: 730, value: s.calendar_days_ahead }), footer: h('textarea', { rows: 2, maxlength: 300 }, s.footer_text),
            tile: h('input', { value: s.map_tile_url, placeholder: 'tyhjä = OpenStreetMap', style: 'width:100%' }), cal: h('input', { type: 'checkbox', checked: s.calendar_enabled === '1' }), reg: h('input', { type: 'checkbox', checked: s.worker_registration === '1' }) };
        const save = async () => { try { await api('PUT', '/settings', { site_name: f.site_name.value, calendar_days_ahead: f.days.value, footer_text: f.footer.value, map_tile_url: f.tile.value, calendar_enabled: f.cal.checked, worker_registration: f.reg.checked }); msg(st, 'Tallennettu', true); } catch (e) { msg(st, e.message); } };
        b.append(h('div', { class: 'card' }, h('h2', {}, 'Asetukset'),
            h('p', {}, h('label', {}, 'Sivuston nimi ', f.site_name)), h('p', {}, h('label', {}, 'Tapahtumat näkyvissä (päivää eteenpäin) ', f.days)),
            h('p', {}, h('label', {}, f.cal, ' Julkinen kalenteri käytössä')), h('p', {}, h('label', {}, f.reg, ' Keikkatyöläisten rekisteröinti auki')),
            h('p', {}, h('label', {}, 'Kalenterisivun alatunniste ', f.footer)), h('p', {}, h('label', {}, 'Karttapalvelun osoite ', f.tile), h('br'), h('span', { class: 'muted' }, 'Jos kartassa lukee "Access blocked", OpenStreetMapin ilmainen palvelin on estänyt liikenteen (runsas käyttö). Käytä silloin omaa tai maksullista palvelua, esim. https://api.maptiler.com/maps/streets/256/{z}/{x}/{y}.png?key=AVAIN')), h('button', { onclick: save }, 'Tallenna'), st));
        const cur = h('input', { type: 'password', placeholder: 'Nykyinen salasana', autocomplete: 'current-password' }), nw = h('input', { type: 'password', placeholder: 'Uusi salasana (väh. 12 merkkiä)', autocomplete: 'new-password' }), pst = h('div', {});
        b.append(h('div', { class: 'card' }, h('h2', {}, 'Vaihda salasana'), h('div', { class: 'row' }, cur, nw, h('button', { onclick: async () => { try { await api('POST', '/password', { current: cur.value, new: nw.value }); cur.value = nw.value = ''; msg(pst, 'Salasana vaihdettu', true); } catch (e) { msg(pst, e.message); } } }, 'Vaihda')), pst));
    },
};
function editPub(box, r, done) {
    const f = { name: h('input', { value: r.name, maxlength: 120 }), city: h('input', { value: r.city || '' }), address: h('input', { value: r.address || '', placeholder: 'Katuosoite' }), website: h('input', { value: r.website || '', placeholder: 'https://…' }),
        lat: h('input', { value: r.lat ?? '', placeholder: 'esim. 60.1699', size: 10 }), lng: h('input', { value: r.lng ?? '', placeholder: 'esim. 24.9384', size: 10 }) }, st = h('div', {});
    const field = (label, input) => h('p', {}, h('label', {}, label, h('br'), input));
    box.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Muokkaa baaria: ' + r.slug),
        h('p', { class: 'muted' }, 'Osoite ja koordinaatit näkyvät kalenterin kartalla. Baarin sovellus lähettää ne yleensä itse, kun baarin julkinen profiili on julkaistu, mutta voit korjata ne tästä.'),
        field('Nimi', f.name), field('Kaupunki', f.city), field('Osoite', f.address), field('Verkkosivu', f.website), h('div', { class: 'row' }, field('Leveyspiiri (lat)', f.lat), field('Pituuspiiri (lng)', f.lng)),
        h('div', { class: 'row' }, h('button', { onclick: async () => { try { await api('PUT', '/pubs/' + r.id, { name: f.name.value, city: f.city.value, status: r.status, address: f.address.value, website: f.website.value, lat: f.lat.value, lng: f.lng.value }); box.replaceChildren(); done(); } catch (e) { msg(st, e.message); } } }, 'Tallenna'),
            h('button', { class: 'ghost', onclick: () => box.replaceChildren() }, 'Peruuta')), st));
    box.scrollIntoView({ behavior: 'smooth' });
}
function showCode(box, r) {
    box.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Liitoskoodi baarille ' + r.slug), h('p', { class: 'muted' }, 'Anna baarin ylläpitäjälle nämä kaksi tietoa. Koodi on kertakäyttöinen ja voimassa 7 päivää. Baarin sovelluksessa: Baari → Asetukset → Keskuspalvelin → Yhdistä.'),
        h('p', {}, 'Keskuksen osoite:'), h('pre', {}, r.url), h('p', {}, 'Liitoskoodi:'), h('pre', {}, r.code)));
}
start();

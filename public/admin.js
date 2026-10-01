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
    const names = { overview: 'Yhteenveto', pubs: 'Baarit', events: 'Tapahtumat', shifts: 'Keikkavuorot', workers: 'Keikkatyöläiset', settings: 'Asetukset' };
    const tabs = h('div', { class: 'tabs' }, Object.entries(names).map(([k, v]) => h('button', { class: k === tab ? 'on' : '', onclick: () => { tab = k; start(); } }, v)),
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
        b.append(h('div', { class: 'grid' }, st('pubs_active', 'Aktiivista baaria'), st('events', 'Tulevaa tapahtumaa'), st('open_shifts', 'Avointa keikkavuoroa'), st('workers', 'Keikkatyöläistä'), st('pending_applications', 'Käsittelemätöntä hakemusta')));
    },
    async pubs(b) {
        const out = h('div', {});
        const slug = h('input', { placeholder: 'tunnus (esim. oma-baari)' }), name = h('input', { placeholder: 'Baarin nimi' }), city = h('input', { placeholder: 'Kaupunki' }), err = h('div', { class: 'err' });
        const add = async () => {
            try { const r = await api('POST', '/pubs', { slug: slug.value, name: name.value, city: city.value }); showKey(out, r); b.replaceChildren(); await views.pubs(b); b.prepend(out); } catch (e) { msg(err, e.message); }
        };
        b.append(h('div', { class: 'card' }, h('h2', {}, 'Lisää baari'), h('p', { class: 'muted' }, 'Palvelin luo baarille avainparin ja näyttää yksityisen avaimen kerran. Liitä näytetty rivi baarin client-asennuksen config.php-tiedostoon.'), h('div', { class: 'row' }, slug, name, city, h('button', { onclick: add }, 'Lisää')), err), out);
        const pubs = (await api('GET', '/pubs')).pubs;
        b.append(table([['Baari', r => r.name + ' (' + r.slug + ')'], ['Kaupunki', r => r.city], ['Tila', r => r.status === 'active' ? 'Aktiivinen' : 'Estetty'], ['Viimeksi yhteydessä', r => r.last_seen_at || 'ei vielä'], ['Tapahtumia', r => r.events], ['Avoimia vuoroja', r => r.open_shifts]], pubs, r => h('div', { class: 'row' },
            h('button', { class: 'ghost', onclick: async () => { await api('PUT', '/pubs/' + r.id, { name: r.name, city: r.city, status: r.status === 'active' ? 'suspended' : 'active' }); start(); } }, r.status === 'active' ? 'Estä' : 'Aktivoi'),
            h('button', { class: 'ghost', onclick: async () => { const n = prompt('Baarin nimi', r.name); if (n === null) return; const c = prompt('Kaupunki', r.city); if (c === null) return; await api('PUT', '/pubs/' + r.id, { name: n, city: c, status: r.status }); start(); } }, 'Muokkaa'),
            h('button', { class: 'ghost', onclick: async () => { if (!confirm('Luodaanko uusi avain? Vanha lakkaa toimimasta heti.')) return; showKey(out, await api('POST', '/pubs/' + r.id + '/rotate_key')); } }, 'Uusi avain'),
            h('button', { class: 'danger', onclick: async () => { if (confirm('Poistetaanko baari ja kaikki sen tapahtumat ja vuorot?')) { await api('DELETE', '/pubs/' + r.id); start(); } } }, 'Poista'))));
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
            cal: h('input', { type: 'checkbox', checked: s.calendar_enabled === '1' }), reg: h('input', { type: 'checkbox', checked: s.worker_registration === '1' }) };
        const save = async () => { try { await api('PUT', '/settings', { site_name: f.site_name.value, calendar_days_ahead: f.days.value, footer_text: f.footer.value, calendar_enabled: f.cal.checked, worker_registration: f.reg.checked }); msg(st, 'Tallennettu', true); } catch (e) { msg(st, e.message); } };
        b.append(h('div', { class: 'card' }, h('h2', {}, 'Asetukset'),
            h('p', {}, h('label', {}, 'Sivuston nimi ', f.site_name)), h('p', {}, h('label', {}, 'Tapahtumat näkyvissä (päivää eteenpäin) ', f.days)),
            h('p', {}, h('label', {}, f.cal, ' Julkinen kalenteri käytössä')), h('p', {}, h('label', {}, f.reg, ' Keikkatyöläisten rekisteröinti auki')),
            h('p', {}, h('label', {}, 'Kalenterisivun alatunniste ', f.footer)), h('button', { onclick: save }, 'Tallenna'), st));
        const cur = h('input', { type: 'password', placeholder: 'Nykyinen salasana', autocomplete: 'current-password' }), nw = h('input', { type: 'password', placeholder: 'Uusi salasana (väh. 12 merkkiä)', autocomplete: 'new-password' }), pst = h('div', {});
        b.append(h('div', { class: 'card' }, h('h2', {}, 'Vaihda salasana'), h('div', { class: 'row' }, cur, nw, h('button', { onclick: async () => { try { await api('POST', '/password', { current: cur.value, new: nw.value }); cur.value = nw.value = ''; msg(pst, 'Salasana vaihdettu', true); } catch (e) { msg(pst, e.message); } } }, 'Vaihda')), pst));
    },
};
function showKey(box, r) {
    box.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Baarin avain – tallenna nyt'), h('p', { class: 'muted' }, 'Yksityinen avain näytetään vain kerran. Lisää rivi baarin client-asennuksen config.php-tiedostoon (return-taulukon sisään):'), h('pre', {}, r.config)));
}
start();

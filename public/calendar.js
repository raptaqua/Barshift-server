// Julkinen tapahtumakalenteri (jaettava ja upotettava). Osoitteet lasketaan sivun omasta polusta → toimii alihakemistossakin.
// Osoiteparametrit: ?city=Turku &type=music,quiz &q=haku &view=cal|map &range=7|weekend|30 &sort=theme|pub &embed=1 (ei otsikkoa, sopii iframeen)
const API = location.pathname.replace(/\/(index\.html)?$/, '');
const $ = id => document.getElementById(id);
const TYPES = { music: ['🎵', 'Musiikki', ['#8B5CF6', '#EC4899']], sports: ['⚽', 'Urheilu', ['#10B981', '#84CC16']], quiz: ['🧠', 'Visa / peli', ['#3B82F6', '#06B6D4']], theme: ['🎉', 'Teemailta', ['#FF9A3C', '#FF5A36']], other: ['📌', 'Muu', ['#64748B', '#94A3B8']] };
const MONTHS = ['tammikuu', 'helmikuu', 'maaliskuu', 'huhtikuu', 'toukokuu', 'kesäkuu', 'heinäkuu', 'elokuu', 'syyskuu', 'lokakuu', 'marraskuu', 'joulukuu'];
const DOWL = ['sunnuntai', 'maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai', 'lauantai'], DOW = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'], MON3 = ['tammi', 'helmi', 'maalis', 'huhti', 'touko', 'kesä', 'heinä', 'elo', 'syys', 'loka', 'marras', 'joulu'];
const S = { events: [], cities: [], city: '', types: new Set(), q: '', view: 'list', month: null, sel: null, range: 'all', sort: 'day', map: null };
const RANGES = [['all', 'Kaikki tulevat'], ['7', '7 päivää'], ['weekend', 'Viikonloppu'], ['30', '30 päivää']];
const SORTS = [['day', 'Päivän mukaan'], ['theme', 'Teeman mukaan'], ['pub', 'Baarin mukaan']];
const typeOf = t => TYPES[t] || TYPES.other;
const grad = t => `linear-gradient(135deg,${typeOf(t)[2][0]},${typeOf(t)[2][1]})`;
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const hm = t => (t || '').slice(0, 5);
function el(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) { if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k.startsWith('aria-')) e.setAttribute(k, String(!!v)); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
}
async function getJson(path) {
    const r = await fetch(API + path), t = await r.text(); let j;
    try { j = JSON.parse(t); } catch (e) { throw new Error('Palvelin vastasi virheellisesti (' + r.status + ')'); }
    if (!r.ok) throw new Error(j.error || 'Virhe ' + r.status);
    return j;
}
function timeText(e) { const a = hm(e.time_start), b = hm(e.time_end); return a ? (b ? `klo ${a}–${b}` : `klo ${a}`) : ''; }
function rangeBounds() {   // [alku, loppu] päivämerkkijonoina tai null (kaikki)
    const now = new Date(), t = new Date(now.getFullYear(), now.getMonth(), now.getDate()), add = n => ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() + n));
    if (S.range === '7') return [add(0), add(6)];
    if (S.range === '30') return [add(0), add(29)];
    if (S.range === 'weekend') { const d = t.getDay(); if (d === 0) return [add(0), add(0)]; if (d === 6) return [add(0), add(1)]; return [add(5 - d), add(7 - d)]; }
    return null;
}
function filtered(useRange = true) {
    const q = S.q.trim().toLowerCase(), rb = useRange ? rangeBounds() : null;
    return S.events.filter(e => (!S.city || e.city === S.city) && (!S.types.size || S.types.has(TYPES[e.type] ? e.type : 'other')) && (!rb || (e.date >= rb[0] && e.date <= rb[1]))
        && (!q || (e.title + ' ' + e.pub + ' ' + (e.city || '') + ' ' + (e.description || '') + ' ' + typeOf(e.type)[1]).toLowerCase().includes(q)));
}
function syncUrl() {
    const p = new URLSearchParams(location.search);
    for (const [k, v] of [['city', S.city], ['type', [...S.types].join(',')], ['q', S.q.trim()], ['view', S.view === 'list' ? '' : S.view], ['range', S.range === 'all' ? '' : S.range], ['sort', S.sort === 'day' ? '' : S.sort]]) { if (v) p.set(k, v); else p.delete(k); }
    history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p : ''));
}

function tile(e) {
    const d = parse(e.date), t = typeOf(e.type), today = e.date === ymd(new Date());
    return el('button', { class: 'tile' + (today ? ' today' : ''), type: 'button', onclick: () => openEvent(e) },
        el('div', { class: 'pic', style: `--g:${grad(e.type)}` }, el('span', {}, t[0]), el('div', { class: 'leaf' }, el('small', {}, MON3[d.getMonth()]), el('b', {}, d.getDate())), el('span', { class: 'type' }, t[1])),
        el('div', { class: 'txt' }, el('h3', {}, e.title), el('div', { class: 'time' }, [timeText(e), e.price_text].filter(Boolean).join(' · ')), el('div', { class: 'where' }, '📍 ' + e.pub + (e.city ? ', ' + e.city : '')),
            e.description ? el('div', { class: 'desc' }, e.description) : null));
}
function renderToolbar() {
    const tb = $('toolbar'); tb.replaceChildren();
    if (S.cities.length > 1) tb.append(el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'Kaupunki'),
        el('button', { class: 'chip', 'aria-pressed': !S.city, onclick: () => { S.city = ''; refresh(); } }, 'Kaikki'),
        S.cities.map(c => el('button', { class: 'chip', 'aria-pressed': S.city === c, onclick: () => { S.city = S.city === c ? '' : c; refresh(); } }, c))));
    if (S.view !== 'cal') tb.append(el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'Aika'), RANGES.map(([k, l]) => el('button', { class: 'chip', 'aria-pressed': S.range === k, onclick: () => { S.range = k; refresh(); } }, l))));
    if (S.view === 'list') tb.append(el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'Järjestys'), SORTS.map(([k, l]) => el('button', { class: 'chip', 'aria-pressed': S.sort === k, onclick: () => { S.sort = k; refresh(); } }, l))));
    const used = [...new Set(S.events.map(e => TYPES[e.type] ? e.type : 'other'))];
    if (used.length > 1) tb.append(el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'Tyyppi'),
        used.map(t => el('button', { class: 'chip', style: `--c:${typeOf(t)[2][0]}`, 'aria-pressed': S.types.has(t), onclick: () => { S.types.has(t) ? S.types.delete(t) : S.types.add(t); refresh(); } }, el('span', { class: 'dot' }), typeOf(t)[0] + ' ' + typeOf(t)[1]))));
}
function renderList(box, rows) {
    if (!rows.length) { box.append(el('div', { class: 'empty' }, el('div', { class: 'big' }, '🍻'), el('h2', {}, 'Ei tapahtumia'), el('p', {}, S.events.length ? 'Kokeile toista hakua tai aikaväliä, tai poista suodattimia.' : 'Tulevia tapahtumia ei ole vielä julkaistu.'))); return; }
    const today = ymd(new Date()), tmr = ymd(new Date(Date.now() + 864e5)), groups = new Map();
    const add = (key, e, head) => { if (!groups.has(key)) groups.set(key, { head, evs: [] }); groups.get(key).evs.push(e); };
    for (const e of rows) {
        if (S.sort === 'theme') { const k = TYPES[e.type] ? e.type : 'other'; add(k, e, () => [el('h2', {}, typeOf(k)[0] + ' ' + typeOf(k)[1])]); }
        else if (S.sort === 'pub') add(e.pub, e, () => [el('h2', {}, '📍 ' + e.pub), e.city ? el('span', { class: 'cnt' }, e.city) : null]);
        else { const d = parse(e.date); add(e.date, e, () => [el('h2', {}, `${DOWL[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`), e.date === today ? el('span', { class: 'tag' }, 'Tänään') : e.date === tmr ? el('span', { class: 'tag tmr' }, 'Huomenna') : null]); }
    }
    let keys = [...groups.keys()];
    if (S.sort === 'theme') keys.sort((a, b) => Object.keys(TYPES).indexOf(a) - Object.keys(TYPES).indexOf(b)); else if (S.sort === 'pub') keys.sort((a, b) => a.localeCompare(b, 'fi'));
    for (const k of keys) { const g = groups.get(k);
        box.append(el('section', { class: 'dayblock' }, el('div', { class: 'dh' }, g.head(), el('span', { class: 'cnt' }, g.evs.length + (g.evs.length === 1 ? ' tapahtuma' : ' tapahtumaa'))), el('div', { class: 'tiles' }, g.evs.map(tile)))); }
}
function renderMap(box, rows) {
    const byPub = new Map(); for (const e of rows) { const k = e.pub + '|' + (e.city || ''); if (!byPub.has(k)) byPub.set(k, { pub: e.pub, city: e.city, address: e.address, lat: e.lat, lng: e.lng, website: e.website, evs: [] }); byPub.get(k).evs.push(e); }
    const pubs = [...byPub.values()], located = pubs.filter(p => p.lat != null && p.lng != null), unlocated = pubs.filter(p => p.lat == null || p.lng == null);
    if (!pubs.length) { box.append(el('div', { class: 'empty' }, el('div', { class: 'big' }, '🗺️'), el('h2', {}, 'Ei tapahtumia kartalla'), el('p', {}, 'Kokeile toista aikaväliä tai poista suodattimia.'))); return; }
    const mapEl = el('div', { id: 'map', class: 'map' }), side = el('div', { class: 'card side' });
    box.append(el('div', { class: 'mapwrap' }, mapEl, side));
    if (typeof L === 'undefined') { mapEl.textContent = 'Karttaa ei voitu ladata.'; }
    else {
        S.map = L.map(mapEl, { scrollWheelZoom: false }); L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(S.map);
        const markers = located.map(p => {
            const icon = L.divIcon({ className: '', html: `<div class="pin"><span>${p.evs.length}</span></div>`, iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -34] });
            const pop = el('div', { class: 'pp' }, el('h4', {}, p.pub), el('div', { class: 'cnt' }, [p.address, p.city].filter(Boolean).join(', ')),
                el('ul', {}, p.evs.slice(0, 6).map(e => el('li', {}, el('button', { type: 'button', onclick: () => openEvent(e) }, `${parse(e.date).getDate()}.${parse(e.date).getMonth() + 1}. ${hm(e.time_start)} ${e.title}`)))),
                p.evs.length > 6 ? el('div', { class: 'cnt' }, `+${p.evs.length - 6} muuta`) : null, p.website && /^https?:\/\//i.test(p.website) ? el('a', { href: p.website, target: '_blank', rel: 'noopener' }, 'Baarin sivut') : null);
            const m = L.marker([p.lat, p.lng], { icon }).addTo(S.map).bindPopup(pop); p.marker = m; return m;
        });
        if (markers.length) S.map.fitBounds(L.featureGroup(markers).getBounds().pad(0.25), { maxZoom: 14 }); else S.map.setView([64.5, 26], 5);
    }
    side.append(el('h3', {}, `${pubs.length} baaria, ${rows.length} tapahtumaa`));
    for (const p of located) side.append(el('button', { class: 'bar-item', type: 'button', onclick: () => { if (S.map && p.marker) { S.map.setView([p.lat, p.lng], 15); p.marker.openPopup(); } } }, el('b', {}, p.pub), el('small', {}, [p.city, p.evs.length + ' tapahtumaa'].filter(Boolean).join(' · '))));
    if (unlocated.length) { side.append(el('div', { class: 'lbl' }, 'Ei sijaintia kartalla')); for (const p of unlocated) side.append(el('div', { class: 'bar-item off' }, el('b', {}, p.pub), el('small', {}, [p.city, p.evs.length + ' tapahtumaa'].filter(Boolean).join(' · ')))); }
}
function renderMonth(box, rows) {
    if (!S.month) { const n = new Date(); S.month = new Date(n.getFullYear(), n.getMonth(), 1); }
    const y = S.month.getFullYear(), m = S.month.getMonth(), first = new Date(y, m, 1), lead = (first.getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate(), today = ymd(new Date());
    const by = {}; for (const e of rows) (by[e.date] = by[e.date] || []).push(e);
    const grid = el('div', { class: 'grid' }, DOW.map(d => el('div', { class: 'dow' }, d)));
    for (let i = 0; i < Math.ceil((lead + days) / 7) * 7; i++) {
        const dt = new Date(y, m, 1 - lead + i), key = ymd(dt), evs = by[key] || [];
        grid.append(el('button', { class: 'day' + (dt.getMonth() !== m ? ' out' : '') + (key === today ? ' today' : '') + (key === S.sel ? ' sel' : ''), type: 'button', onclick: () => { S.sel = S.sel === key ? null : key; refresh(); } },
            el('span', { class: 'n' }, dt.getDate()), evs.slice(0, 3).map(e => el('span', { class: 'pill', style: `--c:${typeOf(e.type)[2][0]}` }, (hm(e.time_start) ? hm(e.time_start) + ' ' : '') + e.title)),
            evs.length > 3 ? el('span', { class: 'more' }, `+${evs.length - 3} lisää`) : null, el('span', { class: 'dots' }, evs.slice(0, 6).map(e => el('i', { style: `--c:${typeOf(e.type)[2][0]}` })))));
    }
    box.append(el('div', { class: 'card' }, el('div', { class: 'cal-head' }, el('h2', { class: 'cal-title' }, `${MONTHS[m]} ${y}`), el('div', { class: 'cal-nav' },
        el('button', { class: 'btn sm', onclick: () => { S.month = new Date(y, m - 1, 1); S.sel = null; refresh(); } }, '‹'), el('button', { class: 'btn sm', onclick: () => { const n = new Date(); S.month = new Date(n.getFullYear(), n.getMonth(), 1); refresh(); } }, 'Tänään'),
        el('button', { class: 'btn sm', onclick: () => { S.month = new Date(y, m + 1, 1); S.sel = null; refresh(); } }, '›'))), grid));
    if (S.sel && by[S.sel]) { const d = parse(S.sel); box.append(el('div', { class: 'card daylist' }, el('h3', {}, `${DOWL[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`), el('div', { class: 'tiles' }, by[S.sel].map(tile)))); }
}
function refresh() {
    document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.id === 't-' + S.view)));
    if (S.map) { S.map.remove(); S.map = null; }
    renderToolbar(); const box = $('view'); box.replaceChildren();
    if (S.view === 'cal') renderMonth(box, filtered(false)); else if (S.view === 'map') renderMap(box, filtered()); else renderList(box, filtered());
    syncUrl();
}

function openEvent(e) {
    const t = typeOf(e.type), d = parse(e.date), m = $('modal');
    m.replaceChildren(el('div', { class: 'img', style: `--g:${grad(e.type)}` }, t[0]), el('button', { class: 'x', type: 'button', 'aria-label': 'Sulje', onclick: closeEvent }, '×'),
        el('div', { class: 'body' }, el('h2', {}, e.title), el('div', { class: 'meta' }, `📅 ${DOWL[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()} ${timeText(e)}`), el('div', { class: 'meta' }, '📍 ' + e.pub + (e.city ? ', ' + e.city : '')),
            e.price_text ? el('div', { class: 'meta' }, '🎟 ' + e.price_text) : null, e.description ? el('p', {}, e.description) : null,
            el('div', { class: 'acts' }, e.url && /^https?:\/\//i.test(e.url) ? el('a', { class: 'btn primary', href: e.url, target: '_blank', rel: 'noopener' }, 'Lisätiedot ja liput') : null,
                el('button', { class: 'btn', type: 'button', onclick: () => downloadIcs(e) }, '📅 Lisää kalenteriin'))));
    $('ov').classList.add('open'); m.querySelector('.x').focus();
}
function closeEvent() { $('ov').classList.remove('open'); }
function downloadIcs(e) {
    const dt = (date, time) => date.replace(/-/g, '') + 'T' + (time || '00:00').slice(0, 5).replace(':', '') + '00';
    const esc = s => String(s || '').replace(/[\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
    const end = e.time_end ? dt(e.date, e.time_end) : dt(e.date, e.time_start ? String(Number(e.time_start.slice(0, 2)) + 3).padStart(2, '0') + e.time_start.slice(2, 5) : '23:59');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BarShift Hub//FI', 'BEGIN:VEVENT', 'UID:' + e.date + '-' + encodeURIComponent(e.title) + '@hub', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]|\.\d+/g, ''), 'DTSTART:' + dt(e.date, e.time_start), 'DTEND:' + end,
        'SUMMARY:' + esc(e.title), 'LOCATION:' + esc(e.pub + (e.city ? ', ' + e.city : '')), 'DESCRIPTION:' + esc(e.description), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const a = el('a', { href: URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })), download: 'tapahtuma.ics' }); document.body.append(a); a.click(); a.remove();
}
async function share() {
    syncUrl(); const url = location.href.replace(/[?&]embed=1/, '');
    try { if (navigator.share) await navigator.share({ title: document.title, url }); else { await navigator.clipboard.writeText(url); $('share').textContent = '✓ Linkki kopioitu'; } } catch (e) { prompt('Kopioi osoite', url); }
}

(async () => {
    const p = new URLSearchParams(location.search);
    if (p.get('embed') === '1') { document.body.classList.add('embed'); $('hero').remove(); }
    S.city = p.get('city') || ''; S.q = p.get('q') || ''; S.view = ['cal', 'map'].includes(p.get('view')) ? p.get('view') : 'list'; S.range = RANGES.some(r => r[0] === p.get('range')) ? p.get('range') : 'all'; S.sort = SORTS.some(r => r[0] === p.get('sort')) ? p.get('sort') : 'day';
    for (const t of (p.get('type') || '').split(',')) if (TYPES[t]) S.types.add(t);
    $('q').value = S.q;
    $('t-list').addEventListener('click', () => { S.view = 'list'; refresh(); }); $('t-cal').addEventListener('click', () => { S.view = 'cal'; refresh(); }); $('t-map').addEventListener('click', () => { S.view = 'map'; refresh(); });
    $('q').addEventListener('input', e => { S.q = e.target.value; refresh(); }); $('share').addEventListener('click', share);
    $('ov').addEventListener('click', e => { if (e.target.id === 'ov') closeEvent(); }); document.addEventListener('keydown', e => { if (e.key === 'Escape') closeEvent(); });
    try {
        const c = await getJson('/api/config'); const t = $('title'); if (t) t.textContent = c.site_name; document.title = c.site_name; $('footer').textContent = c.footer_text || ''; S.cities = c.cities || [];
        if (!c.calendar_enabled) { $('view').textContent = 'Kalenteri ei ole käytössä.'; return; }
    } catch (e) { /* asetukset eivät estä tapahtumien näyttöä */ }
    try { S.events = (await getJson('/api/events?limit=500')).events || []; if (!S.cities.length) S.cities = [...new Set(S.events.map(e => e.city).filter(Boolean))].sort(); refresh(); }
    catch (e) { $('view').replaceChildren(el('div', { class: 'empty' }, el('div', { class: 'big' }, '⚠️'), el('h2', {}, 'Tapahtumien lataus epäonnistui'), el('p', {}, e.message))); }
})();

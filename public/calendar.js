// Julkinen tapahtumakalenteri (jaettava ja upotettava). Osoitteet lasketaan sivun omasta polusta → toimii alihakemistossakin.
// Osoiteparametrit: ?city=Turku &type=music,quiz &q=haku &view=cal &embed=1 (ei otsikkoa, sopii iframeen)
const API = location.pathname.replace(/\/(index\.html)?$/, '');
const $ = id => document.getElementById(id);
const TYPES = { music: ['🎵', 'Musiikki', ['#8B5CF6', '#EC4899']], sports: ['⚽', 'Urheilu', ['#10B981', '#84CC16']], quiz: ['🧠', 'Visa / peli', ['#3B82F6', '#06B6D4']], theme: ['🎉', 'Teemailta', ['#FF9A3C', '#FF5A36']], other: ['📌', 'Muu', ['#64748B', '#94A3B8']] };
const MONTHS = ['tammikuu', 'helmikuu', 'maaliskuu', 'huhtikuu', 'toukokuu', 'kesäkuu', 'heinäkuu', 'elokuu', 'syyskuu', 'lokakuu', 'marraskuu', 'joulukuu'];
const DOWL = ['sunnuntai', 'maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai', 'lauantai'], DOW = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'], MON3 = ['tammi', 'helmi', 'maalis', 'huhti', 'touko', 'kesä', 'heinä', 'elo', 'syys', 'loka', 'marras', 'joulu'];
const S = { events: [], cities: [], city: '', types: new Set(), q: '', view: 'list', month: null, sel: null };
const typeOf = t => TYPES[t] || TYPES.other;
const grad = t => `linear-gradient(135deg,${typeOf(t)[2][0]},${typeOf(t)[2][1]})`;
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const hm = t => (t || '').slice(0, 5);
function el(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) { if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v); }
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
function filtered() {
    const q = S.q.trim().toLowerCase();
    return S.events.filter(e => (!S.city || e.city === S.city) && (!S.types.size || S.types.has(TYPES[e.type] ? e.type : 'other')) && (!q || (e.title + ' ' + e.pub + ' ' + (e.city || '') + ' ' + (e.description || '')).toLowerCase().includes(q)));
}
function syncUrl() {
    const p = new URLSearchParams(location.search);
    for (const [k, v] of [['city', S.city], ['type', [...S.types].join(',')], ['q', S.q.trim()], ['view', S.view === 'cal' ? 'cal' : '']]) { if (v) p.set(k, v); else p.delete(k); }
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
    const used = [...new Set(S.events.map(e => TYPES[e.type] ? e.type : 'other'))];
    if (used.length > 1) tb.append(el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'Tyyppi'),
        used.map(t => el('button', { class: 'chip', style: `--c:${typeOf(t)[2][0]}`, 'aria-pressed': S.types.has(t), onclick: () => { S.types.has(t) ? S.types.delete(t) : S.types.add(t); refresh(); } }, el('span', { class: 'dot' }), typeOf(t)[0] + ' ' + typeOf(t)[1]))));
}
function renderList(box, rows) {
    if (!rows.length) { box.append(el('div', { class: 'empty' }, el('div', { class: 'big' }, '🍻'), el('h2', {}, 'Ei tapahtumia'), el('p', {}, S.events.length ? 'Kokeile toista hakua tai poista suodattimia.' : 'Tulevia tapahtumia ei ole vielä julkaistu.'))); return; }
    const today = ymd(new Date()), tmr = ymd(new Date(Date.now() + 864e5)); const byDay = new Map();
    for (const e of rows) { if (!byDay.has(e.date)) byDay.set(e.date, []); byDay.get(e.date).push(e); }
    for (const [date, evs] of byDay) {
        const d = parse(date);
        box.append(el('section', { class: 'dayblock' }, el('div', { class: 'dh' }, el('h2', {}, `${DOWL[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`), date === today ? el('span', { class: 'tag' }, 'Tänään') : date === tmr ? el('span', { class: 'tag tmr' }, 'Huomenna') : null, el('span', { class: 'cnt' }, evs.length + (evs.length === 1 ? ' tapahtuma' : ' tapahtumaa'))),
            el('div', { class: 'tiles' }, evs.map(tile))));
    }
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
    document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String((t.id === 't-cal') === (S.view === 'cal'))));
    renderToolbar(); const box = $('view'); box.replaceChildren(); const rows = filtered();
    S.view === 'cal' ? renderMonth(box, rows) : renderList(box, rows); syncUrl();
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
    S.city = p.get('city') || ''; S.q = p.get('q') || ''; S.view = p.get('view') === 'cal' ? 'cal' : 'list';
    for (const t of (p.get('type') || '').split(',')) if (TYPES[t]) S.types.add(t);
    $('q').value = S.q;
    $('t-list').addEventListener('click', () => { S.view = 'list'; refresh(); }); $('t-cal').addEventListener('click', () => { S.view = 'cal'; refresh(); });
    $('q').addEventListener('input', e => { S.q = e.target.value; refresh(); }); $('share').addEventListener('click', share);
    $('ov').addEventListener('click', e => { if (e.target.id === 'ov') closeEvent(); }); document.addEventListener('keydown', e => { if (e.key === 'Escape') closeEvent(); });
    try {
        const c = await getJson('/api/config'); const t = $('title'); if (t) t.textContent = c.site_name; document.title = c.site_name; $('footer').textContent = c.footer_text || ''; S.cities = c.cities || [];
        if (!c.calendar_enabled) { $('view').textContent = 'Kalenteri ei ole käytössä.'; return; }
    } catch (e) { /* asetukset eivät estä tapahtumien näyttöä */ }
    try { S.events = (await getJson('/api/events?limit=500')).events || []; if (!S.cities.length) S.cities = [...new Set(S.events.map(e => e.city).filter(Boolean))].sort(); refresh(); }
    catch (e) { $('view').replaceChildren(el('div', { class: 'empty' }, el('div', { class: 'big' }, '⚠️'), el('h2', {}, 'Tapahtumien lataus epäonnistui'), el('p', {}, e.message))); }
})();

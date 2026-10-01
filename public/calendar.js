// Julkinen tapahtumakalenteri. Osoitteet lasketaan sivun omasta polusta, joten toimii myös alihakemistossa (esim. /hub/).
const API = location.pathname.replace(/\/(index\.html)?$/, '');
const $ = id => document.getElementById(id);
let ALL = [];
function el(tag, text, cls) { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; }
async function getJson(path) {
    const r = await fetch(API + path);
    const t = await r.text(); let j;
    try { j = JSON.parse(t); } catch (e) { throw new Error('Palvelin vastasi virheellisesti (' + r.status + '). ' + t.slice(0, 80)); }
    if (!r.ok) throw new Error(j.error || ('Virhe ' + r.status));
    return j;
}
const WD = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];
function dayLabel(d) { const [y, m, dd] = d.split('-').map(Number); return `${WD[new Date(y, m - 1, dd).getDay()]} ${dd}.${m}.${y}`; }
function render() {
    const q = $('q').value.trim().toLowerCase(), list = $('list'); list.textContent = '';
    const rows = ALL.filter(e => !q || (e.title + ' ' + e.pub + ' ' + (e.description || '')).toLowerCase().includes(q));
    if (!rows.length) { list.textContent = 'Ei tulevia tapahtumia.'; return; }
    let last = '';
    for (const e of rows) {
        if (e.date !== last) { list.append(el('div', dayLabel(e.date), 'day')); last = e.date; }
        const d = el('div', '', 'card ev');
        d.append(el('b', e.title));
        const t = (e.time_start || '').slice(0, 5), t2 = (e.time_end || '').slice(0, 5);
        d.append(el('div', [t && (t2 ? t + '–' + t2 : 'klo ' + t), e.pub + (e.city ? ', ' + e.city : ''), e.price_text].filter(Boolean).join(' · '), 'muted'));
        if (e.type) d.append(el('span', e.type, 'pill'));
        if (e.description) d.append(el('div', e.description));
        if (e.url && /^https?:\/\//i.test(e.url)) { const a = el('a', 'Lisätiedot'); a.href = e.url; a.rel = 'noopener'; d.append(a); }
        list.append(d);
    }
}
async function load() {
    $('list').textContent = 'Ladataan…';
    try {
        const city = $('city').value;
        ALL = (await getJson('/public/events' + (city ? '?city=' + encodeURIComponent(city) : ''))).events || [];
        render();
    } catch (e) { $('list').textContent = 'Lataus epäonnistui: ' + e.message; }
}
(async () => {
    try {
        const c = await getJson('/public/config');
        $('title').textContent = c.site_name; document.title = c.site_name; $('footer').textContent = c.footer_text || '';
        for (const city of c.cities) { const o = document.createElement('option'); o.value = city; o.textContent = city; $('city').append(o); }
        if (!c.calendar_enabled) { $('list').textContent = 'Kalenteri ei ole käytössä.'; return; }
    } catch (e) { /* konfiguraatio ei estä tapahtumien näyttöä */ }
    $('city').addEventListener('change', load); $('q').addEventListener('input', render);
    load();
})();

const list = document.getElementById('list'), city = document.getElementById('city');
function el(tag, text, cls) { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; }
async function load() {
    list.textContent = 'Ladataan…';
    try {
        const r = await (await fetch('public/events' + (city.value ? '?city=' + encodeURIComponent(city.value) : ''))).json();
        list.textContent = '';
        if (!r.events || !r.events.length) { list.textContent = 'Ei tulevia tapahtumia.'; return; }
        for (const e of r.events) {
            const d = el('div', '', 'ev');
            d.append(el('b', e.title), el('div', `${e.date} ${(e.time_start || '').slice(0, 5)} · ${e.pub}${e.city ? ', ' + e.city : ''}${e.price_text ? ' · ' + e.price_text : ''}`, 'meta'));
            if (e.description) d.append(el('div', e.description));
            if (e.url && /^https?:\/\//i.test(e.url)) { const a = el('a', 'Lisätiedot'); a.href = e.url; a.rel = 'noopener'; d.append(a); }
            list.append(d);
        }
    } catch (e) { list.textContent = 'Lataus epäonnistui'; }
}
city.addEventListener('change', load); load();

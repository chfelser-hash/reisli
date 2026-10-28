// Zeitstrahl: alle Reisetage als waagrechter Streifen (wischen auf dem Handy, scrollen/Pfeile am PC)
import { h } from '../ui.js';
import { tripDates, dayNumber, weekday, fmtDateShort, fmt0, placeFor, isStay, todayStr } from '../calc.js';

/**
 * @param trip    Reise
 * @param sum     tripSummary (für Tagestotal)
 * @param selected gewähltes Datum (oder null)
 * @param onSelect (date) => void
 */
export function timeline(trip, sum, selected, onSelect) {
  const today = todayStr();
  const dates = tripDates(trip);
  const withItems = new Set(trip.items.filter((it) => !isStay(it) && (it.payments || []).some((p) => p.date)).map((it) => it.date));
  const strip = h('div', { class: 'tl-strip', role: 'listbox', 'aria-label': 'Reisetag wählen' },
    dates.map((d) => {
      const c = sum.byDay.get(d) || { total: 0, allowance: 0 };
      const total = c.total + c.allowance;
      const place = placeFor(trip, null, d);
      const cls = ['tl-day', d === selected && 'on', d === today && 'today', d < today && 'past'].filter(Boolean).join(' ');
      return h('button', { type: 'button', class: cls, role: 'option', 'aria-selected': String(d === selected), dataset: { date: d }, onclick: () => onSelect(d) },
        h('span', { class: 'tl-no' }, d === today ? 'Heute' : 'Tag ' + dayNumber(trip, d)),
        h('span', { class: 'tl-date' }, weekday(d) + ' ' + fmtDateShort(d)),
        h('span', { class: 'tl-place' }, place || ' '),
        h('span', { class: 'tl-sum' }, total ? fmt0(total) : '–', withItems.has(d) ? h('i', { class: 'tl-dot', title: 'Ausgaben erfasst' }) : null)
      );
    })
  );
  // Mausrad am PC: senkrecht scrollen bewegt den Streifen waagrecht, solange er noch weiter kann
  strip.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    const max = strip.scrollWidth - strip.clientWidth;
    if ((e.deltaY > 0 && strip.scrollLeft < max - 1) || (e.deltaY < 0 && strip.scrollLeft > 0)) {
      strip.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }, { passive: false });
  const page = (dir) => strip.scrollBy({ left: dir * strip.clientWidth * 0.8, behavior: 'smooth' });
  const wrap = h('div', { class: 'timeline' },
    h('button', { type: 'button', class: 'tl-nav prev', 'aria-label': 'frühere Tage', onclick: () => page(-1) }, '‹'),
    strip,
    h('button', { type: 'button', class: 'tl-nav next', 'aria-label': 'spätere Tage', onclick: () => page(1) }, '›')
  );
  // Gewählten Tag (sonst heute) in die Mitte holen, sobald der Streifen im Dokument ist
  const focus = selected || (today >= trip.start && today <= trip.end ? today : null);
  if (focus) requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = strip.querySelector(`[data-date="${focus}"]`);
    if (el) strip.scrollLeft = el.offsetLeft - strip.clientWidth / 2 + el.offsetWidth / 2;
  }));
  return wrap;
}

// Kalender für Von–Bis direkt im Dialog (wie in Flux): ersten Tag antippen, letzten Tag antippen – ohne «OK».
// Wochenenden sind blass, Tage anderer Reisen haben einen Punkt, der gewählte Zeitraum ist hinterlegt.
import { h } from '../ui.js';
import { addDays, daysBetween, fmtDate, MONTHS } from '../calc.js';

const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const dow = (d) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))).getUTCDay(); // 0 = Sonntag

function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/**
 * range: {from, to} (wird verändert); onChange() nach jeder Auswahl.
 * busy: [{from, to, name}] andere Reisen (nur Anzeige)
 */
export function rangeCalendar({ range, today, busy = [], onChange = () => {} }) {
  let picking = 'from';
  let view = range.from.slice(0, 7);
  const root = h('div', { class: 'rcal' });

  const pick = (d) => {
    if (picking === 'from' || d < range.from) {
      range.from = d;
      range.to = d;
      picking = 'to';
    } else {
      range.to = d;
      picking = 'from';
    }
    draw();
    onChange();
  };

  function draw() {
    root.dataset.month = view;
    root.dataset.picking = picking;
    const first = `${view}-01`;
    const lead = (dow(first) + 6) % 7; // Montag zuerst
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(h('span', { class: 'rcal-blank' }));
    for (let d = first; d.startsWith(view); d = addDays(d, 1)) {
      const other = busy.filter((t) => t.from <= d && t.to >= d);
      const cls = ['rcal-day'];
      if (dow(d) === 0 || dow(d) === 6) cls.push('rcal-off');
      if (other.length) cls.push('rcal-busy');
      if (d === today) cls.push('today');
      if (d >= range.from && d <= range.to) cls.push('in');
      if (d === range.from) cls.push('start');
      if (d === range.to) cls.push('end');
      cells.push(h('button', {
        type: 'button', class: cls.join(' '), dataset: { date: d },
        title: other.length ? other.map((t) => t.name).join(', ') : null,
        'aria-label': fmtDate(d) + (other.length ? ` (${other.map((t) => t.name).join(', ')})` : ''),
        'aria-pressed': String(d >= range.from && d <= range.to),
        onclick: () => pick(d),
      }, String(Number(d.slice(8)))));
    }
    const [yy, mm] = view.split('-').map(Number);
    const nights = daysBetween(range.from, range.to);
    root.replaceChildren(
      h('div', { class: 'rcal-sel' },
        h('button', { type: 'button', class: 'rcal-chip' + (picking === 'from' ? ' on' : ''), onclick: () => { picking = 'from'; view = range.from.slice(0, 7); draw(); } },
          h('span', null, 'Von'), h('strong', null, fmtDate(range.from))),
        h('button', { type: 'button', class: 'rcal-chip' + (picking === 'to' ? ' on' : ''), onclick: () => { picking = 'to'; view = range.to.slice(0, 7); draw(); } },
          h('span', null, 'Bis'), h('strong', null, fmtDate(range.to)))),
      h('p', { class: 'rcal-hint' }, picking === 'from'
        ? `Tippe auf den ersten Tag. · ${nights + 1} Tag${nights ? 'e' : ''}, ${nights} ${nights === 1 ? 'Nacht' : 'Nächte'}`
        : 'Jetzt den letzten Tag antippen (bei Bedarf mit › weiterblättern).'),
      h('div', { class: 'rcal-nav' },
        h('button', { type: 'button', class: 'icon-btn rcal-prev', 'aria-label': 'Vorheriger Monat', onclick: () => { view = shiftMonth(view, -1); draw(); } }, '‹'),
        h('strong', null, `${MONTHS[mm - 1]} ${yy}`),
        h('button', { type: 'button', class: 'icon-btn rcal-next', 'aria-label': 'Nächster Monat', onclick: () => { view = shiftMonth(view, 1); draw(); } }, '›')),
      h('div', { class: 'rcal-grid' }, WD.map((w) => h('span', { class: 'rcal-wd' }, w)), cells));
  }

  root.redraw = draw;
  draw();
  return root;
}

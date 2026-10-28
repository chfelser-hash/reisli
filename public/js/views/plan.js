// Ansicht «Plan»: Reiseablauf Tag für Tag (Posten, Unterkünfte, Pauschalen) und kompakte Übersicht
import { h, modal, toast } from '../ui.js';
import { state, trip, settings, go, saveDay, render, api, tripCurrencies } from '../app.js';
import {
  tripDates, tripSummary, itemCalc, fmt, fmt0, fmtCur, fmtDay, fmtRange, dayNumber, daysBetween, todayStr, isStay,
  nights, stayFor, placeFor, dayCurrency, isDate, STATUS,
} from '../calc.js';
import { editItem, blankItem, catDot } from './item.js';
import { timeline } from './timeline.js';
import { newTripDialog } from './newtrip.js';

let mode = (() => { try { return localStorage.getItem('reisli.planMode') || 'tage'; } catch { return 'tage'; } })();
let onlyCosts = false;

export function renderPlan() {
  const t = trip();
  if (!t) return welcome();
  const S = settings();
  const today = todayStr();
  const sum = tripSummary(S, t, today);
  const dates = tripDates(t);

  const view = h('div', { class: 'view plan' }, tripHead(t, sum, today));
  const seg = (id, label) => h('button', { class: 'seg' + (mode === id ? ' on' : ''), onclick: () => { mode = id; try { localStorage.setItem('reisli.planMode', id); } catch { /* egal */ } render(); } }, label);
  view.append(h('div', { class: 'toolbar' },
    h('div', { class: 'segs' }, seg('tage', 'Tage'), seg('uebersicht', 'Übersicht')),
    mode === 'tage' ? h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: onlyCosts, onchange: (e) => { onlyCosts = e.target.checked; render(); } }), 'nur Posten mit Kosten') : null,
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn primary', onclick: () => editItem(blankItem(today >= t.start && today <= t.end ? today : t.start)) }, '+ Posten')
  ));

  if (mode === 'uebersicht') view.append(overviewTable(t, sum, dates));
  else {
    const list = h('div', { class: 'days' }, dates.map((d) => dayCard(t, sum, d, today)));
    // Zeitstrahl als Sprungnavigation (bleibt beim Scrollen oben)
    const tl = timeline(t, sum, state.params.day || null, (d) => {
      for (const b of tl.querySelectorAll('.tl-day')) b.classList.toggle('on', b.dataset.date === d);
      document.getElementById('d-' + d)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    tl.classList.add('sticky');
    view.append(tl, list);
    // Während der Reise direkt zum heutigen Tag springen
    const target = state.params.day || (today > t.start && today <= t.end ? today : null);
    if (target) setTimeout(() => document.getElementById('d-' + target)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
    state.params.day = null;
  }
  return view;
}

function welcome() {
  return h('div', { class: 'view' },
    h('div', { class: 'card welcome' },
      h('img', { src: '/icons/icon.svg', alt: '', width: 72, height: 72 }),
      h('h1', null, 'Willkommen bei Reisli'),
      h('p', { class: 'muted' }, 'Lege deine erste Reise an oder übernimm eine bestehende Ferien-Excel.'),
      h('div', { class: 'row gap wrap center-row' },
        h('button', { class: 'btn primary big', onclick: () => newTripDialog('leer') }, '+ Neue Reise'),
        h('button', { class: 'btn big', onclick: () => newTripDialog('excel') }, 'Excel importieren')
      )
    )
  );
}

function countdown(t, today) {
  if (today < t.start) {
    const k = daysBetween(today, t.start);
    return k === 1 ? 'morgen geht’s los' : `noch ${k} Tage`;
  }
  if (today <= t.end) return `Tag ${dayNumber(t, today)} von ${dayNumber(t, t.end)}`;
  return 'abgeschlossen';
}

function tripHead(t, sum, today) {
  const pct = sum.forecast > 0 ? Math.min(100, (sum.paid / sum.forecast) * 100) : 0;
  const people = sum.travelers;
  return h('section', { class: 'card trip-head' },
    h('div', { class: 'th-top' },
      h('div', null,
        h('h1', null, t.name, t.archived ? h('span', { class: 'tag-arch' }, 'archiviert') : null),
        h('p', { class: 'muted' }, `${fmtRange(t.start, t.end)} · ${tripDates(t).length} Tage`)
      ),
      h('div', { class: 'th-actions' },
        h('span', { class: 'badge' }, countdown(t, today)),
        h('button', { class: 'icon-btn', 'aria-label': 'Reise bearbeiten', title: 'Reise bearbeiten: Daten, Pauschalen, Aufteilung', onclick: () => go('reise') }, '✎'))
    ),
    h('div', { class: 'kpis four' },
      kpi('Prognose total', 'CHF ' + fmt0(sum.forecast), sum.allowance ? `inkl. ${fmt0(sum.allowance)} Pauschalen` : ''),
      kpi(people > 1 ? `Pro Person (${people})` : 'Pro Person', 'CHF ' + fmt0(sum.perPerson)),
      kpi('Bezahlt', 'CHF ' + fmt0(sum.paid), fmt0(pct) + ' %'),
      kpi('Noch offen', 'CHF ' + fmt0(sum.open + sum.allowance), sum.open ? `${fmt0(sum.open)} Posten + ${fmt0(sum.allowance)} Pauschalen` : '')
    ),
    h('span', { class: 'bar big', title: `${fmt0(pct)} % bezahlt` }, h('span', { style: { width: pct + '%' } })),
    sum.missingRates ? h('p', { class: 'warn' }, `${sum.missingRates} Posten ohne Wechselkurs – unter Mehr → Währungen & Kurse nachtragen.`) : null
  );
}

const kpi = (label, value, sub) => h('div', { class: 'kpi' }, h('span', { class: 'kl' }, label), h('span', { class: 'kv' }, value), sub ? h('span', { class: 'ks' }, sub) : null);

function dayCard(t, sum, d, today) {
  const S = settings();
  const day = t.days?.[d] || {};
  const items = t.items
    .filter((it) => !isStay(it) && it.date === d)
    .sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  const shown = onlyCosts ? items.filter((it) => itemCalc(S, it).hasCost) : items;
  const stay = stayFor(t, d);
  const allow = (sum.allow.get(d) || []).filter((x) => x.allowance.mode === 'tag' || x.extraCHF > 0);
  const costs = sum.byDay.get(d) || { total: 0, allowance: 0 };
  const dayTotal = costs.total + costs.allowance;
  const place = placeFor(t, null, d);
  const isToday = d === today;

  const el = h('section', { class: 'card day' + (isToday ? ' today' : '') + (d < today ? ' past' : ''), id: 'd-' + d },
    h('header', { class: 'day-head' },
      h('span', { class: 'day-no' }, 'Tag ' + dayNumber(t, d)),
      h('div', { class: 'day-title' },
        h('strong', null, fmtDay(d)),
        day.title ? h('span', null, day.title) : null,
        place ? h('span', { class: 'place' }, place) : null,
        dayCurrency(t, d) !== t.currency ? h('span', { class: 'cur-tag', title: 'Währung vor Ort' }, dayCurrency(t, d)) : null
      ),
      h('span', { class: 'day-sum' }, dayTotal ? 'CHF ' + fmt0(dayTotal) : ''),
      h('button', { class: 'icon-btn sm', 'aria-label': 'Tag bearbeiten', title: 'Programm, Ort, Pauschalen', onclick: () => editDay(t, d) }, '✎')
    ),
    day.note ? h('p', { class: 'day-note' }, day.note) : null,
    h('ul', { class: 'items' },
      stay ? stayRow(t, stay, d) : null,
      shown.map((it) => itemRow(it)),
      allow.map((x) => allowanceRow(x, d, today))
    ),
    h('button', { class: 'add-row', onclick: () => editItem(blankItem(d, { place: '' })) }, '+ Posten')
  );
  return el;
}

function stayRow(t, stay, d) {
  const S = settings();
  const c = itemCalc(S, stay);
  const n = nights(stay);
  const i = daysBetween(stay.date, d) + 1;
  const first = stay.date === d;
  return h('li', null, h('button', { class: 'item stay', onclick: () => editItem(stay) },
    h('span', { class: 'it-time' }, '🛏'),
    h('span', { class: 'it-main' },
      h('span', { class: 'it-title' }, stay.title),
      h('span', { class: 'it-meta' }, first ? `Check-in · ${n} ${n === 1 ? 'Nacht' : 'Nächte'} bis ${fmtDay(stay.endDate)}` : `Nacht ${i} von ${n}`, stay.files?.length ? ' · 📎' : '')
    ),
    first && c.hasCost ? h('span', { class: 'pill ' + STATUS[c.status].cls }, c.label) : h('span'),
    h('span', { class: 'it-amt' }, first && c.hasCost ? amountCell(stay, c) : c.hasCost ? h('small', { class: 'muted' }, 'CHF ' + fmt0(c.totalCHF / n) + '/Nacht') : '')
  ));
}

function itemRow(it) {
  const c = itemCalc(settings(), it);
  const todos = (it.todos || []).filter((x) => !x.done).length;
  return h('li', null, h('button', { class: 'item' + (c.hasCost ? '' : ' info'), onclick: () => editItem(it) },
    h('span', { class: 'it-time' }, it.time || ''),
    h('span', { class: 'it-main' },
      h('span', { class: 'it-title' }, catDot(it.catId), it.title),
      h('span', { class: 'it-meta' }, [it.detail, it.place].filter(Boolean).join(' · '), todos ? ` · ☐ ${todos}` : '', it.files?.length ? ' · 📎' : '', it.link ? ' · 🔗' : '')
    ),
    c.hasCost ? h('span', { class: 'pill ' + STATUS[c.status].cls }, c.label) : h('span'),
    h('span', { class: 'it-amt' }, c.hasCost ? amountCell(it, c) : '')
  ));
}

function amountCell(it, c) {
  const cur = it.plan?.currency || 'CHF';
  // Angezahlt: zusätzlich den offenen Rest zeigen (in der Währung des Postens, CHF dahinter)
  const rest = c.status === 'angezahlt' && c.open > 0
    ? [h('small', { class: 'rest' }, `Rest ${fmtCur(c.open, cur)}`), cur !== 'CHF' ? h('small', { class: 'rest' }, `≈ CHF ${fmt(c.openCHF)}`) : null]
    : null;
  if (cur === 'CHF' || !it.plan.amount) return h('span', { class: 'two' }, h('span', null, fmt(c.totalCHF)), rest);
  return h('span', { class: 'two' }, h('span', null, fmtCur(it.plan.amount, cur)), h('small', null, 'CHF ' + fmt(c.totalCHF)), rest);
}

function allowanceRow(x, d, today) {
  const a = x.allowance;
  let text, cls = '';
  if (a.mode === 'platzhalter') text = 'Platzhalter, bis eine Unterkunft erfasst ist';
  else if (x.actualCHF > 0) {
    text = `erfasst ${fmt0(x.actualCHF)} von ${fmt0(x.budgetCHF)}`;
    cls = x.actualCHF > x.budgetCHF ? ' over' : '';
  } else text = d < today ? 'Pauschale (nichts erfasst)' : 'Pauschale pro Tag';
  return h('li', { class: 'item allowance' + cls },
    h('span', { class: 'it-time' }),
    h('span', { class: 'it-main' }, h('span', { class: 'it-title' }, catDot(a.catId), a.label), h('span', { class: 'it-meta' }, text)),
    h('span'),
    h('span', { class: 'it-amt' }, x.extraCHF ? fmt(x.extraCHF) : '–')
  );
}

async function editDay(t, d) {
  const day = { title: '', place: '', note: '', skip: [], currency: '', ...(t.days?.[d] || {}) };
  day.skip = [...(day.skip || [])];
  const applicable = (t.allowances || []).filter((a) => a.per !== 'nacht' || d < t.end);
  // Währung vor Ort: gilt für die Pauschalen dieses Tages; optional für einen ganzen Bereich übernehmen
  const range = { to: d };
  const rangeTo = h('input', { type: 'date', value: d, min: d, max: t.end, onchange: (e) => (range.to = e.target.value) });
  const curBox = h('div', { class: 'span2 day-cur' },
    h('label', null, 'Währung vor Ort',
      h('select', { onchange: (e) => (day.currency = e.target.value) },
        h('option', { value: '', selected: !day.currency }, `Reisewährung (${t.currency})`),
        tripCurrencies().filter((c) => c !== t.currency).map((c) => h('option', { value: c, selected: c === day.currency }, c)))),
    h('label', null, 'Gilt bis und mit', rangeTo),
    h('p', { class: 'hint' }, 'Gilt für alles, was an diesem Tag vor Ort bezahlt wird (Posten und Pauschalen) – z.B. Reisetage in der Schweiz auf CHF stellen. «Gilt bis und mit» überträgt die Währung auf alle Tage bis dahin.')
  );
  const content = h('div', { class: 'form-grid' },
    h('label', { class: 'span2' }, 'Programm', h('input', { value: day.title, placeholder: 'z.B. Transfer nach Khao Lak', oninput: (e) => (day.title = e.target.value) })),
    h('label', null, 'Ort', h('input', { value: day.place, placeholder: 'z.B. Bangkok', oninput: (e) => (day.place = e.target.value) })),
    h('label', { class: 'span2' }, 'Notiz', h('textarea', { rows: 2, oninput: (e) => (day.note = e.target.value) }, day.note)),
    curBox,
    applicable.length ? h('div', { class: 'span2' },
      h('span', { class: 'label' }, 'Pauschalen an diesem Tag'),
      applicable.map((a) => h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: !day.skip.includes(a.id), onchange: (e) => (day.skip = e.target.checked ? day.skip.filter((x) => x !== a.id) : [...day.skip, a.id]) }),
        `${a.label} (${fmt0(a.amount)} ${a.currency} pro ${a.per === 'nacht' ? 'Nacht' : 'Tag'})`
      )),
      h('p', { class: 'hint' }, 'Z.B. auf dem Liveaboard ist das Essen inbegriffen → Pauschale ausschalten.')
    ) : null
  );
  const r = await modal(`${fmtDay(d)} · Tag ${dayNumber(t, d)}`, content, [
    { label: 'Abbrechen', value: null },
    { label: 'Speichern', primary: true, value: 'ok' },
  ]);
  if (r !== 'ok') return;
  try {
    await saveDay(d, day);
    if (isDate(range.to) && range.to > d) {
      const res = await api('POST', `/api/trips/${t.id}/days-currency`, { from: d, to: range.to, currency: day.currency });
      t.days = res.days;
    }
    render();
  } catch (e) {
    toast(e.message, { error: true });
  }
}

function overviewTable(t, sum, dates) {
  const S = settings();
  const rows = dates.map((d) => {
    const day = t.days?.[d] || {};
    const stay = stayFor(t, d);
    const costs = sum.byDay.get(d) || { total: 0, allowance: 0 };
    const program = day.title || t.items.filter((it) => it.date === d && !isStay(it)).map((it) => it.title).slice(0, 2).join(', ');
    return h('tr', { class: 'clickable', onclick: () => { mode = 'tage'; state.params.day = d; render(); } },
      h('td', { class: 'num muted' }, dayNumber(t, d)),
      h('td', null, fmtDay(d)),
      h('td', { class: 'wrap-cell' }, program),
      h('td', null, placeFor(t, null, d)),
      h('td', { class: 'wrap-cell' }, stay ? stay.title : ''),
      h('td', { class: 'num' }, fmt0(costs.total + costs.allowance))
    );
  });
  return h('section', { class: 'card' },
    h('div', { class: 'table-scroll' },
      h('table', { class: 'overview' },
        h('thead', null, h('tr', null, h('th', { class: 'num' }, 'Tag'), h('th', null, 'Datum'), h('th', null, 'Programm'), h('th', null, 'Ort'), h('th', null, 'Übernachtung'), h('th', { class: 'num' }, 'CHF'))),
        h('tbody', null, rows),
        h('tfoot', null, h('tr', null, h('td'), h('th', { colspan: 4 }, 'Total (inkl. Pauschalen)'), h('td', { class: 'num' }, fmt0(sum.forecast))))
      )
    )
  );
}


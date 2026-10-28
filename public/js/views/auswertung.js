// Ansicht «Auswertung»: Kategorien, Kosten pro Tag (Plan vs. Ist), Orte, Bezahlmethoden, Aufteilung, Export
import { h, s } from '../ui.js';
import { trip, settings, cat, methodName, download, go } from '../app.js';
import { tripSummary, byMethod, settlement, tripDates, dayNumber, fmt, fmt0, fmtDay, todayStr, isStay, nights } from '../calc.js';
import { renderPlan } from './plan.js';

export function renderAuswertung() {
  const t = trip();
  if (!t) return renderPlan();
  const S = settings();
  const today = todayStr();
  const sum = tripSummary(S, t, today);
  return h('div', { class: 'view auswertung' },
    h('div', { class: 'grid-2' }, categories(t, sum), methods(t, sum)),
    perDay(t, sum, today),
    h('div', { class: 'grid-2' }, places(t, sum), split(t, today)),
    exportCard(t)
  );
}

// ---------- Kategorien ----------
function categories(t, sum) {
  const rows = [...sum.byCat.entries()]
    .map(([id, v]) => ({ id, total: v.total + v.allowance, paid: v.paid, open: v.open + v.allowance, allowance: v.allowance }))
    .filter((r) => r.total > 0.004)
    .sort((a, b) => b.total - a.total);
  const max = Math.max(1, ...rows.map((r) => r.total));
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'Nach Kategorie'), h('span', { class: 'muted' }, 'CHF ' + fmt0(sum.forecast))),
    rows.length ? h('table', { class: 'cats' },
      h('thead', null, h('tr', null, h('th', null, 'Kategorie'), h('th', { class: 'num' }, 'Total'), h('th', { class: 'num' }, 'Anteil'), h('th', { class: 'bar-col' }), h('th', { class: 'num' }, 'offen'))),
      h('tbody', null, rows.map((r) => {
        const c = cat(r.id);
        return h('tr', null,
          h('td', null, h('span', { class: 'dot', style: { '--c': c.color } }), c.name, r.allowance ? h('small', { class: 'muted' }, ` inkl. ${fmt0(r.allowance)} Pauschale`) : null),
          h('td', { class: 'num strong' }, fmt0(r.total)),
          h('td', { class: 'num muted' }, fmt0((r.total / (sum.forecast || 1)) * 100) + ' %'),
          h('td', { class: 'bar-col' }, h('span', { class: 'bar' }, h('span', { style: { width: (r.total / max) * 100 + '%', '--c': c.color } }))),
          h('td', { class: 'num muted' }, r.open > 0.5 ? fmt0(r.open) : '–')
        );
      }))
    ) : h('p', { class: 'empty' }, 'Noch keine Kosten erfasst.')
  );
}

// ---------- Bezahlmethoden ----------
function methods(t, sum) {
  const S = settings();
  const rows = byMethod(S, t).sort((a, b) => b.paid + b.planned - (a.paid + a.planned));
  const paid = rows.reduce((a, r) => a + r.paid, 0);
  const planned = rows.reduce((a, r) => a + r.planned, 0);
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'Abrechnung nach Bezahlmethode')),
    h('table', { class: 'simple' },
      h('thead', null, h('tr', null, h('th', null, 'Methode'), h('th', { class: 'num' }, 'bezahlt'), h('th', { class: 'num' }, 'noch offen'), h('th', { class: 'num' }, 'Total'))),
      h('tbody', null, rows.map((r) => h('tr', null,
        h('td', null, methodName(r.methodId)),
        h('td', { class: 'num' }, r.paid ? fmt(r.paid) : '–'),
        h('td', { class: 'num muted' }, r.planned ? fmt(r.planned) : '–'),
        h('td', { class: 'num strong' }, fmt(r.paid + r.planned))
      ))),
      h('tfoot', null,
        h('tr', null, h('th', null, 'Posten'), h('td', { class: 'num' }, fmt(paid)), h('td', { class: 'num' }, fmt(planned)), h('td', { class: 'num' }, fmt(paid + planned))),
        sum.allowance ? h('tr', { class: 'sub' }, h('th', null, 'Pauschalen'), h('td'), h('td', { class: 'num' }, fmt(sum.allowance)), h('td', { class: 'num' }, fmt(sum.allowance))) : null,
        h('tr', null, h('th', null, 'Prognose total'), h('td'), h('td'), h('td', { class: 'num' }, fmt(sum.forecast))),
        h('tr', { class: 'sub' }, h('th', null, `Pro Person (${sum.travelers})`), h('td'), h('td'), h('td', { class: 'num' }, fmt(sum.perPerson)))
      )
    ),
    h('p', { class: 'hint' }, '«noch offen» ist der Betrag, der mit dieser Methode bezahlt werden soll (beim Posten unter «Wird bezahlt mit»). Ohne Angabe erscheint er unter «— ohne —» bzw. «vor Ort».')
  );
}

// ---------- Kosten pro Tag ----------
function perDay(t, sum, today) {
  const dates = tripDates(t);
  const data = dates.map((d) => {
    const v = sum.byDay.get(d) || { total: 0, allowance: 0 };
    return { d, items: v.total, allow: v.allowance, all: v.total + v.allowance };
  });
  const max = Math.max(1, ...data.map((x) => x.all));
  // Breite so, dass das Diagramm auf dem Desktop nicht zu hoch wird und auf dem Handy scrollt statt schrumpft
  const W = Math.max(900, dates.length * 30), H = 220, top = 12, bottom = 22, left = 4;
  const bw = (W - left) / dates.length;
  const y = (v) => (v / max) * (H - top - bottom);
  const tip = h('div', { class: 'chart-tip', hidden: true });
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'day-chart', role: 'img', 'aria-label': 'Kosten pro Tag', style: `min-width:${Math.max(560, dates.length * 24)}px` });
  // Gitterlinie in der Mitte + Achse
  svg.append(s('line', { x1: 0, x2: W, y1: H - bottom, y2: H - bottom, class: 'axis' }));
  svg.append(s('line', { x1: 0, x2: W, y1: H - bottom - y(max / 2), y2: H - bottom - y(max / 2), class: 'grid' }));
  svg.append(s('text', { x: W - 2, y: H - bottom - y(max / 2) - 4, class: 'grid-lbl', 'text-anchor': 'end' }, 'CHF ' + fmt0(max / 2)));
  data.forEach((x, i) => {
    const gx = left + i * bw;
    const barW = Math.max(4, bw - 6);
    const bx = gx + (bw - barW) / 2;
    const g = s('g', { class: 'col' + (x.d === today ? ' today' : '') });
    const hi = y(x.items), ha = y(x.allow);
    const gap = hi > 0 && ha > 0 ? 2 : 0;
    if (hi > 0) g.append(s('rect', { x: bx, y: H - bottom - hi, width: barW, height: hi, rx: ha > 0 ? 0 : Math.min(4, barW / 2), class: 'b-items' }));
    if (ha > 0) g.append(s('rect', { x: bx, y: H - bottom - hi - gap - ha, width: barW, height: ha, rx: Math.min(4, barW / 2), class: 'b-allow' }));
    if (dates.length <= 31 || i % 2 === 0) g.append(s('text', { x: gx + bw / 2, y: H - 6, class: 'b-lbl' }, dayNumber(t, x.d)));
    // Trefferfläche über die ganze Spalte
    const hit = s('rect', { x: gx, y: 0, width: bw, height: H, class: 'hit' });
    const show = (e) => {
      tip.hidden = false;
      tip.replaceChildren(
        h('strong', null, `Tag ${dayNumber(t, x.d)} · ${fmtDay(x.d)}`),
        h('span', null, h('i', { class: 'sw items' }), 'Posten: CHF ' + fmt0(x.items)),
        h('span', null, h('i', { class: 'sw allow' }), 'Pauschalen: CHF ' + fmt0(x.allow)),
        h('span', { class: 'strong' }, 'Total: CHF ' + fmt0(x.all))
      );
      const box = wrap.getBoundingClientRect();
      const px = (e.clientX ?? box.left) - box.left;
      tip.style.left = Math.min(Math.max(0, px - 80), box.width - 170) + 'px';
    };
    hit.addEventListener('pointerenter', show);
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerleave', () => (tip.hidden = true));
    g.append(hit);
    svg.append(g);
  });
  const wrap = h('div', { class: 'chart-wrap' }, h('div', { class: 'chart-scroll' }, svg), tip);

  // Tagesbudget: Plan vs. Ist (nur Tage mit erfassten Ausgaben)
  const budgetRows = [];
  for (const d of dates) for (const x of sum.allow.get(d) || []) if (x.allowance.mode === 'tag' && x.actualCHF > 0) budgetRows.push({ d, ...x });
  const totB = budgetRows.reduce((a, r) => a + r.budgetCHF, 0);
  const totA = budgetRows.reduce((a, r) => a + r.actualCHF, 0);

  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'Kosten pro Tag'),
      h('span', { class: 'legend' }, h('span', null, h('i', { class: 'sw items' }), 'Posten'), h('span', null, h('i', { class: 'sw allow' }), 'Pauschalen'))),
    wrap,
    h('details', { class: 'table-view' },
      h('summary', null, 'Als Tabelle'),
      h('div', { class: 'table-scroll' }, h('table', { class: 'simple' },
        h('thead', null, h('tr', null, h('th', null, 'Tag'), h('th', null, 'Datum'), h('th', { class: 'num' }, 'Posten'), h('th', { class: 'num' }, 'Pauschalen'), h('th', { class: 'num' }, 'Total'))),
        h('tbody', null, data.map((x) => h('tr', null, h('td', null, dayNumber(t, x.d)), h('td', null, fmtDay(x.d)), h('td', { class: 'num' }, fmt0(x.items)), h('td', { class: 'num' }, fmt0(x.allow)), h('td', { class: 'num strong' }, fmt0(x.all)))))
      ))
    ),
    budgetRows.length ? h('div', { class: 'plan-ist' },
      h('h3', null, 'Tagesbudget: Plan vs. Ist'),
      h('div', { class: 'table-scroll' }, h('table', { class: 'simple' },
        h('thead', null, h('tr', null, h('th', null, 'Datum'), h('th', null, 'Pauschale'), h('th', { class: 'num' }, 'Budget'), h('th', { class: 'num' }, 'Ist'), h('th', { class: 'num' }, 'Differenz'))),
        h('tbody', null, budgetRows.map((r) => h('tr', null,
          h('td', null, fmtDay(r.d)), h('td', null, r.allowance.label),
          h('td', { class: 'num' }, fmt0(r.budgetCHF)), h('td', { class: 'num' }, fmt0(r.actualCHF)),
          h('td', { class: 'num ' + (r.actualCHF > r.budgetCHF ? 'neg' : 'pos') }, (r.actualCHF > r.budgetCHF ? '+' : '−') + fmt0(Math.abs(r.actualCHF - r.budgetCHF)))
        ))),
        h('tfoot', null, h('tr', null, h('th', { colspan: 2 }, 'Total'), h('td', { class: 'num' }, fmt0(totB)), h('td', { class: 'num' }, fmt0(totA)), h('td', { class: 'num ' + (totA > totB ? 'neg' : 'pos') }, (totA > totB ? '+' : '−') + fmt0(Math.abs(totA - totB)))))
      ))
    ) : h('p', { class: 'hint' }, 'Sobald unterwegs Ausgaben erfasst werden, erscheint hier der Vergleich Tagesbudget vs. Ist.')
  );
}

// ---------- Orte ----------
function places(t, sum) {
  // Nächte pro Ort aus den Unterkünften
  const nightsBy = new Map();
  for (const it of t.items) if (isStay(it)) {
    const p = it.place || t.days?.[it.date]?.place || it.title;
    nightsBy.set(p, (nightsBy.get(p) || 0) + nights(it));
  }
  const rows = [...sum.byPlace.entries()].map(([p, v]) => ({ p, total: v.total + v.allowance })).filter((r) => r.total > 0.004).sort((a, b) => b.total - a.total);
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'Nach Ort')),
    rows.length ? h('table', { class: 'simple' },
      h('thead', null, h('tr', null, h('th', null, 'Ort'), h('th', { class: 'num' }, 'Nächte'), h('th', { class: 'num' }, 'CHF'), h('th', { class: 'num' }, 'pro Nacht'))),
      h('tbody', null, rows.map((r) => {
        const n = nightsBy.get(r.p) || 0;
        return h('tr', null, h('td', null, r.p), h('td', { class: 'num muted' }, n || '–'), h('td', { class: 'num strong' }, fmt0(r.total)), h('td', { class: 'num muted' }, n ? fmt0(r.total / n) : '–'));
      }))
    ) : h('p', { class: 'empty' }, 'Noch keine Kosten.'),
    h('p', { class: 'hint' }, 'Ort = Ortsangabe des Tages, sonst der Unterkunft. Flüge zählen zum Ort des Abflugtags.')
  );
}

// ---------- Aufteilung ----------
function split(t, today) {
  if (!t.split?.enabled) {
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Kostenaufteilung')),
      h('p', { class: 'muted' }, 'Reist ihr mit anderen und wollt Kosten aufteilen? Unter «Mehr → Reise» die Aufteilung einschalten und Teilnehmende erfassen. Bei jeder Zahlung lässt sich dann festhalten, wer bezahlt hat.'),
      h('button', { class: 'btn', onclick: () => go('mehr', { section: 'split' }) }, 'Aufteilung einrichten')
    );
  }
  const st = settlement(settings(), t, today);
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'Kostenaufteilung')),
    h('table', { class: 'simple' },
      h('thead', null, h('tr', null, h('th', null, 'Person'), h('th', { class: 'num' }, 'hat bezahlt'), h('th', { class: 'num' }, 'Anteil'), h('th', { class: 'num' }, 'Saldo'), h('th', { class: 'num' }, 'Anteil Prognose'))),
      h('tbody', null, st.people.map((p) => h('tr', null,
        h('td', null, p.name),
        h('td', { class: 'num' }, fmt(p.paid)),
        h('td', { class: 'num' }, fmt(p.share)),
        h('td', { class: 'num strong ' + (p.balance > 0.005 ? 'pos' : p.balance < -0.005 ? 'neg' : '') }, (p.balance > 0 ? '+' : '') + fmt(p.balance)),
        h('td', { class: 'num muted' }, fmt(p.forecastShare))
      )))
    ),
    st.unassigned ? h('p', { class: 'warn' }, `CHF ${fmt(st.unassigned)} an Zahlungen ohne «bezahlt von» – bei den Posten ergänzen.`) : null,
    h('h3', { class: 'mt' }, 'Ausgleich'),
    st.transfers.length
      ? h('ul', { class: 'transfers' }, st.transfers.map((x) => h('li', null, h('strong', null, x.fromName), ' → ', h('strong', null, x.toName), h('span', { class: 'num strong' }, 'CHF ' + fmt(x.amount)))))
      : h('p', { class: 'muted' }, 'Alles ausgeglichen.'),
    h('p', { class: 'hint' }, 'Grundlage sind die effektiv geleisteten Zahlungen. «Anteil Prognose» zeigt, was am Ende inkl. offener Beträge und Pauschalen auf jede Person entfällt.')
  );
}

// ---------- Export ----------
function exportCard(t) {
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'Export')),
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn', onclick: () => download(`/api/trips/${t.id}/export.csv`) }, 'Als CSV (Excel)'),
      h('button', { class: 'btn', onclick: () => download(`/api/trips/${t.id}/export.json`) }, 'Reise als Sicherungsdatei'),
      h('button', { class: 'btn', onclick: () => window.print() }, 'Drucken')
    )
  );
}

// «Heute»: die Reise unterwegs – was steht heute an, wo schlafen wir, Belege griffbereit, Budget im Blick.
// Funktioniert auch offline mit dem zuletzt geladenen Stand.
import { h, toast, modal, confirmDialog } from '../ui.js';
import { state, trip, settings, render, go, api, sync, reload, methodName, updateNetBadge } from '../app.js';
import { kvSet } from '../idb.js';
import {
  todayStr, addDays, daysBetween, dayNumber, fmt, fmt0, fmtCur, fmtDay, fmtDate, itemCalc, STATUS, isStay,
  placeFor, stayFor, dayCurrency, allowanceMap, tripSummary, cashPlan, rateOf, fromCHF,
} from '../calc.js';
import { editItem, catDot } from './item.js';

const FILES_CACHE = 'reisli-files';

/** Läuft die Reise (oder beginnt sie in den nächsten «lead» Tagen)? */
export function tripRunning(t, lead = 0) {
  const today = todayStr();
  return today >= addDays(t.start, -lead) && today <= t.end;
}

export function renderHeute() {
  const t = trip();
  const view = h('div', { class: 'view heute' });
  if (!t) {
    view.append(h('div', { class: 'card' }, h('p', null, 'Noch keine Reise gewählt.')));
    return view;
  }
  const S = settings();
  const today = todayStr();
  const clamp = (d) => (d < t.start ? t.start : d > t.end ? t.end : d);
  const date = clamp(state.params.heuteDate || today);
  const setDate = (d) => { state.params.heuteDate = clamp(d); render(); window.scrollTo(0, 0); };

  // ----- Kopf mit Tagesnavigation -----
  const n = dayNumber(t, date);
  const total = daysBetween(t.start, t.end) + 1;
  const day = t.days?.[date] || {};
  const place = placeFor(t, null, date);
  const rel = date === today ? 'Heute' : date === addDays(today, 1) ? 'Morgen' : date === addDays(today, -1) ? 'Gestern' : '';
  view.append(h('section', { class: 'card today-head' },
    h('div', { class: 'th-nav' },
      h('button', { class: 'icon-btn', 'aria-label': 'Vorheriger Tag', disabled: date <= t.start, onclick: () => setDate(addDays(date, -1)) }, '‹'),
      h('div', { class: 'th-mid' },
        h('div', { class: 'th-kicker' }, today < t.start ? `Start in ${daysBetween(today, t.start)} Tag${daysBetween(today, t.start) === 1 ? '' : 'en'}` : `Tag ${n} von ${total}`),
        h('h1', null, [rel, fmtDay(date)].filter(Boolean).join(' · ')),
        h('div', { class: 'muted' }, [place, day.title].filter(Boolean).join(' · ') || t.name)
      ),
      h('button', { class: 'icon-btn', 'aria-label': 'Nächster Tag', disabled: date >= t.end, onclick: () => setDate(addDays(date, 1)) }, '›')
    ),
    date !== clamp(today) ? h('button', { class: 'btn small ghost', onclick: () => setDate(today) }, 'Zurück zu heute') : null,
    day.note ? h('p', { class: 'day-note' }, day.note) : null,
    h('button', { class: 'btn primary big block', onclick: () => go('erfassen') }, '+ Ausgabe erfassen')
  ));

  // ----- Unterkunft -----
  const stay = stayFor(t, date);
  const checkout = (t.items || []).find((it) => isStay(it) && it.endDate === date);
  if (stay || checkout) {
    view.append(h('section', { class: 'card' },
      h('h2', null, 'Unterkunft'),
      checkout && checkout !== stay ? stayBlock(checkout, `Check-out heute`) : null,
      stay ? stayBlock(stay, stay.date === date ? `Check-in heute · ${nightsLabel(stay)}` : `Nacht ${daysBetween(stay.date, date) + 1} von ${daysBetween(stay.date, stay.endDate)} · bis ${fmtDay(stay.endDate)}`) : null
    ));
  }

  // ----- Programm des Tages -----
  const items = (t.items || []).filter((it) => it.date === date && !isStay(it)).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  view.append(h('section', { class: 'card' },
    h('h2', null, 'Programm'),
    items.length ? h('ul', { class: 'agenda' }, items.map((it) => agendaRow(S, it))) : h('p', { class: 'muted' }, 'Nichts geplant.')
  ));

  // ----- Ausblick morgen -----
  if (date < t.end) {
    const tomorrow = addDays(date, 1);
    const tItems = (t.items || []).filter((it) => it.date === tomorrow).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    const tPlace = placeFor(t, null, tomorrow);
    view.append(h('section', { class: 'card soft' },
      h('h2', null, `${fmtDay(tomorrow)}${tPlace && tPlace !== place ? ' · ' + tPlace : ''}`),
      tItems.length
        ? h('ul', { class: 'agenda compact' }, tItems.map((it) => h('li', null, h('span', { class: 'ag-time' }, it.time || ''), h('span', null, catDot(it.catId), it.title, isStay(it) ? h('span', { class: 'muted' }, ' · Check-in') : null))))
        : h('p', { class: 'muted' }, 'Nichts geplant.')
    ));
  }

  view.append(budgetCard(S, t, date, today), receiptsCard(t), offlineCard());
  return view;
}

const nightsLabel = (it) => { const k = daysBetween(it.date, it.endDate); return `${k} Nacht${k === 1 ? '' : 'e'}`; };

function stayBlock(it, sub) {
  return h('div', { class: 'stay-block' },
    h('button', { class: 'linklike st-title', onclick: () => editItem(it) }, it.title),
    h('div', { class: 'muted small' }, sub),
    contactLines(it),
    fileButtons(it)
  );
}

/** Adresse (Karte), Telefon, Buchungsnummer, Link */
function contactLines(it) {
  const rows = [];
  if (it.address) rows.push(h('a', { class: 'contact', href: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(it.address), target: '_blank', rel: 'noopener' }, '📍 ', it.address));
  if (it.phone) rows.push(h('a', { class: 'contact', href: 'tel:' + it.phone.replace(/[^\d+]/g, '') }, '📞 ', it.phone));
  if (it.bookingRef) rows.push(h('span', { class: 'contact' }, '🔖 ', h('span', { class: 'mono' }, it.bookingRef), h('button', { class: 'btn small ghost', onclick: () => copy(it.bookingRef) }, 'kopieren')));
  if (it.link) rows.push(h('a', { class: 'contact', href: it.link, target: '_blank', rel: 'noopener' }, '🔗 Buchung öffnen'));
  return rows.length ? h('div', { class: 'contacts' }, rows) : null;
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Kopiert'); } catch { toast(text); }
}

function fileButtons(it) {
  if (!it.files?.length) return null;
  return h('div', { class: 'file-chips' }, it.files.map((f) => h('a', { class: 'file-chip', href: '/api/files/' + f.id, target: '_blank', rel: 'noopener' }, '📎 ', f.name)));
}

function agendaRow(S, it) {
  const c = itemCalc(S, it);
  return h('li', { class: 'ag-row' },
    h('span', { class: 'ag-time' }, it.time || ''),
    h('div', { class: 'ag-body' },
      h('button', { class: 'linklike ag-title', onclick: () => editItem(it) }, catDot(it.catId), it.title),
      it.detail || it.place ? h('div', { class: 'muted small' }, [it.detail, it.place].filter(Boolean).join(' · ')) : null,
      contactLines(it),
      fileButtons(it)
    ),
    c.hasCost ? h('div', { class: 'ag-amt' },
      h('span', { class: 'pill ' + STATUS[c.status].cls }, c.status === 'bezahlt' ? 'bezahlt' : c.open ? fmtCur(c.open, it.plan.currency) : c.label),
      c.open && it.payWhere === 'vorort' ? h('div', { class: 'muted small' }, 'vor Ort') : null
    ) : null
  );
}

// ----- Budget -----
function budgetCard(S, t, date, today) {
  const cur = dayCurrency(t, date);
  const hasRate = Number.isFinite(rateOf(S, cur));
  const inCur = (chf) => (cur === 'CHF' || !hasRate ? 'CHF ' + fmt(chf) : `${cur} ${fmt0(fromCHF(S, chf, cur))}`);
  // Tagesbudget (Pauschalen wie Essen & Trinken) vs. erfasste Ausgaben derselben Kategorien
  const allow = (allowanceMap(S, t, today).get(date) || []).filter((x) => x.allowance.mode !== 'platzhalter');
  const budget = allow.reduce((a, x) => a + x.budgetCHF, 0);
  const budgetCats = new Set(allow.map((x) => x.allowance.catId));
  let spent = 0;
  for (const it of t.items || []) if (it.date === date && !isStay(it) && (budgetCats.has(it.catId) || !budget)) spent += itemCalc(S, it).totalCHF;
  const sum = tripSummary(S, t, today);
  // Bargeld/Vor-Ort-Bedarf ab dem gewählten Tag bis Reiseende
  const cash = cashPlan(S, t, { withAllowances: true, from: date, today });
  const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  return h('section', { class: 'card' },
    h('h2', null, 'Budget'),
    budget > 0 ? h('div', { class: 'budget-day' },
      h('div', { class: 'row' }, h('span', null, date === today ? 'Heute ausgegeben' : `Ausgaben ${fmtDay(date)}`), h('span', { class: 'spacer' }), h('strong', null, inCur(spent)), h('span', { class: 'muted' }, ' / ' + inCur(budget))),
      h('div', { class: 'meter' + (spent > budget ? ' over' : '') }, h('span', { style: { width: pct + '%' } })),
      h('div', { class: 'muted small' }, spent > budget ? `${inCur(spent - budget)} über dem Tagesbudget` : `noch ${inCur(budget - spent)} im Tagesbudget`)
    ) : h('p', { class: 'muted' }, `Ausgaben ${fmtDay(date)}: ${inCur(spent)}`),
    h('dl', { class: 'facts' },
      cash.length ? [h('dt', null, 'Vor Ort noch nötig bis Reiseende'), h('dd', null, cash.map((g) => fmtCur(g.total, g.currency)).join(' + '))] : null,
      h('dt', null, 'Bezahlt bisher'), h('dd', null, 'CHF ' + fmt(sum.paid)),
      h('dt', null, 'Prognose Reise total'), h('dd', null, 'CHF ' + fmt(sum.forecast))
    )
  );
}

// ----- Belege -----
function receiptsCard(t) {
  const withFiles = (t.items || []).filter((it) => it.files?.length).sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
  const files = withFiles.flatMap((it) => it.files);
  const status = h('span', { class: 'muted small' });
  const list = h('ul', { class: 'receipts' }, withFiles.map((it) => h('li', null,
    h('span', { class: 'muted small r-date' }, fmtDay(it.date)),
    h('div', null, h('div', { class: 'r-title' }, it.title), fileButtons(it))
  )));
  const btn = h('button', { class: 'btn small', onclick: () => cacheFiles(files, status, btn) }, 'Alle offline speichern');
  if (files.length) countCached(files).then((k) => {
    status.textContent = `${k} von ${files.length} offline verfügbar`;
    if (k === files.length) btn.textContent = 'Aktualisieren';
  });
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, `Belege & Tickets`), files.length && 'caches' in window ? btn : null),
    files.length ? status : null,
    files.length ? list : h('p', { class: 'muted' }, 'Noch keine Belege. Im Posten unter «Belege» Tickets, Buchungsbestätigungen usw. anhängen.')
  );
}

async function countCached(files) {
  if (!('caches' in window)) return 0;
  try {
    const c = await caches.open(FILES_CACHE);
    const hits = await Promise.all(files.map((f) => c.match('/api/files/' + f.id)));
    return hits.filter(Boolean).length;
  } catch { return 0; }
}

/** Alle Belege einer Reise in den Gerätespeicher laden, damit sie unterwegs ohne Verbindung aufgehen */
export async function cacheFiles(files, statusEl, btn) {
  if (!('caches' in window)) return toast('Dieser Browser kann keine Belege offline speichern (HTTPS nötig).', { error: true });
  try { await navigator.storage?.persist?.(); } catch { /* egal */ }
  btn.disabled = true;
  const c = await caches.open(FILES_CACHE);
  let ok = 0, fail = 0;
  for (const f of files) {
    try {
      const res = await fetch('/api/files/' + f.id, { credentials: 'same-origin' });
      if (!res.ok) throw new Error();
      await c.put('/api/files/' + f.id, res);
      ok++;
    } catch { fail++; }
    statusEl.textContent = `${ok} von ${files.length} gespeichert${fail ? ` · ${fail} fehlgeschlagen` : ''} …`;
  }
  btn.disabled = false;
  statusEl.textContent = fail ? `${ok} von ${files.length} offline verfügbar · ${fail} nicht erreichbar` : `Alle ${ok} Belege offline verfügbar`;
  toast(fail ? 'Nicht alle Belege konnten geladen werden' : 'Belege offline gespeichert', fail ? { error: true } : {});
}

// ----- Offline-Status -----
function offlineCard() {
  const n = state.outbox.length;
  const c = state.conflicts.length;
  const when = state.savedAt ? new Date(state.savedAt) : null;
  const ago = when ? fmtAgo(when) : 'unbekannt';
  return h('section', { class: 'card soft' },
    h('div', { class: 'card-head' },
      h('h2', null, state.offline ? 'Offline' : 'Verbunden'),
      h('button', { class: 'btn small', onclick: () => syncDialog() }, c ? `⚠ ${c} prüfen` : 'Details')
    ),
    h('p', { class: 'muted small' },
      state.offline
        ? `Kein Kontakt zum Reisli-Server – du siehst den Stand von ${ago}. Ausgaben, Zahlungen und To-dos kannst du trotzdem erfassen; sie werden automatisch übertragen, sobald die Verbindung wieder da ist.`
        : `Daten aktuell (Stand ${ago}).`,
      n ? ` ${n} Änderung${n === 1 ? '' : 'en'} warte${n === 1 ? 't' : 'n'} auf Übertragung.` : ''
    )
  );
}

function fmtAgo(d) {
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  if (min < 24 * 60) return `heute ${d.toTimeString().slice(0, 5)}`.replace('heute', d.toDateString() === new Date().toDateString() ? 'heute' : 'gestern');
  return fmtDate(todayStr(d)) + ' ' + d.toTimeString().slice(0, 5);
}

// ----- Übersicht Synchronisation & Konflikte -----
const opLabel = (o) => {
  const tr = state.data.trips.find((x) => x.id === o.tripId);
  const items = tr?.items || [];
  const title = (id) => items.find((x) => x.id === id)?.title || 'Posten';
  switch (o.kind) {
    case 'item-new': return `Neu: ${(Array.isArray(o.body) ? o.body : [o.body]).map((x) => x.title).join(', ')}`;
    case 'item-put': return `Geändert: ${o.body.title || title(o.itemId)}`;
    case 'item-del': return `Gelöscht: ${title(o.itemId)}`;
    case 'rep-new': return `Rückzahlung CHF ${fmt(o.body.amount)}`;
    case 'rep-del': return 'Rückzahlung gelöscht';
    default: return o.kind;
  }
};

function itemSummary(S, it) {
  if (!it) return h('em', null, 'gelöscht');
  const c = itemCalc(S, it);
  return h('div', { class: 'small' },
    h('div', null, h('strong', null, it.title), ' · ', fmtDay(it.date)),
    h('div', null, `Betrag ${fmtCur(it.plan?.amount || 0, it.plan?.currency || 'CHF')} · ${(it.payments || []).length} Zahlung(en) · bezahlt CHF ${fmt(c.paidCHF)}`),
    (it.payments || []).length ? h('ul', { class: 'mini' }, it.payments.map((p) => h('li', null, `${fmtDate(p.date) || '—'} ${fmtCur(p.amount, p.currency)}${Number.isFinite(p.chf) && p.currency !== 'CHF' ? ` (CHF ${fmt(p.chf)})` : ''} ${p.methodId ? methodName(p.methodId) : ''}`))) : null,
    it.note ? h('div', { class: 'muted' }, it.note) : null
  );
}

export async function syncDialog() {
  const S = settings();
  const body = h('div', { class: 'stack sync-dlg' });
  const saveConf = () => { kvSet('conflicts', state.conflicts); updateNetBadge(); };
  const draw = () => {
    const n = state.outbox.length;
    body.replaceChildren(
      h('p', null, state.offline ? '🔴 Keine Verbindung zum Reisli-Server.' : '🟢 Verbunden.', ' ',
        h('span', { class: 'muted' }, state.savedAt ? `Datenstand ${fmtAgo(new Date(state.savedAt))}.` : '')),
      n ? h('div', null, h('h3', null, `Wartet auf Übertragung (${n})`), h('ul', { class: 'mini' }, state.outbox.map((o) => h('li', null, opLabel(o), h('span', { class: 'muted' }, ' · ' + new Date(o.at).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })))))) : h('p', { class: 'muted' }, 'Keine wartenden Änderungen.'),
      h('button', { class: 'btn', onclick: async (e) => {
        e.target.disabled = true;
        await sync();
        if (!state.offline && !state.outbox.length) { try { await reload(false); } catch { /* egal */ } }
        draw();
        render();
      } }, 'Jetzt synchronisieren'),
      ...state.conflicts.map((c) => conflictBox(S, c, async (action) => {
        if (action === 'mine') {
          try {
            if (c.mine) await api('PUT', `/api/trips/${c.tripId}/items/${c.itemId}`, { ...c.mine, baseUpdatedAt: undefined });
            else await api(c.op.method, c.op.url, c.op.body);
          } catch (ex) { return toast(ex.message, { error: true }); }
        }
        state.conflicts = state.conflicts.filter((x) => x !== c);
        saveConf();
        if (!state.offline) { try { await reload(false); } catch { /* egal */ } }
        draw();
        render();
      }))
    );
  };
  draw();
  await modal('Synchronisation', body, [{ label: 'Schliessen' }]);
}

function conflictBox(S, c, act) {
  if (c.mine) {
    return h('div', { class: 'conflict' },
      h('h3', null, '⚠ Gleichzeitig geändert'),
      h('p', { class: 'muted small' }, 'Dieser Posten wurde offline auf diesem Gerät und in der Zwischenzeit auch anderswo geändert. Welche Version soll gelten?'),
      h('div', { class: 'conflict-cols' },
        h('div', null, h('div', { class: 'kl' }, 'Meine (offline)'), itemSummary(S, c.mine)),
        h('div', null, h('div', { class: 'kl' }, 'Auf dem Server'), itemSummary(S, c.theirs))
      ),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn primary small', onclick: () => act('mine') }, 'Meine übernehmen'),
        h('button', { class: 'btn small', onclick: () => act('theirs') }, 'Server-Version behalten')
      )
    );
  }
  return h('div', { class: 'conflict' },
    h('h3', null, '⚠ Nicht übertragen'),
    h('p', { class: 'small' }, opLabel(c.op), h('span', { class: 'muted' }, ' – ' + c.error)),
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn small', onclick: () => act('mine') }, 'Nochmals versuchen'),
      h('button', { class: 'btn small danger', onclick: async () => { if (await confirmDialog('Verwerfen', 'Diese Änderung endgültig verwerfen?', 'Verwerfen', true)) act('drop'); } }, 'Verwerfen')
    )
  );
}

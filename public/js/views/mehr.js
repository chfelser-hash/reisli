// Ansicht «Mehr»: Reise-Einstellungen, Pauschalen, Aufteilung, Vorlagen, Excel-Import,
// Bezahlmethoden, Kategorien, Währungen & Kurse, Benutzer, Sicherung
import { h, modal, toast, confirmDialog } from '../ui.js';
import { state, api, reload, render, trip, settings, selectTrip, saveTripMeta, download } from '../app.js';
import { fmt, fmt0, fmtCur, fmtDate, fmtDay, tripSummary, todayStr, addDays, isDate, currencies, daysBetween } from '../calc.js';

const uid = () => Math.random().toString(36).slice(2, 10);

export function renderMehr() {
  const t = trip();
  const params = state.params || {};
  const view = h('div', { class: 'view mehr' });
  if (params.newTrip || !state.data.trips.length) view.append(newTripCard());
  if (t) {
    view.append(h('h2', { class: 'section-title' }, 'Reise «' + t.name + '»'));
    view.append(h('div', { class: 'settings-grid' }, tripCard(t), allowanceCard(t), splitCard(t)));
  }
  view.append(h('h2', { class: 'section-title' }, 'Allgemein'));
  view.append(h('div', { class: 'settings-grid' }, tripsCard(), importCard(), methodsCard(), categoriesCard(), ratesCard(), usersCard(), backupCard()));
  view.append(h('div', { class: 'row gap wrap' },
    h('button', { class: 'btn ghost', onclick: async () => { await api('POST', '/api/logout'); location.reload(); } }, 'Abmelden'),
    h('span', { class: 'muted small' }, `Angemeldet als ${state.data.user.name}`)
  ));
  if (params.section) setTimeout(() => document.getElementById('sec-' + params.section)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  state.params = {};
  return view;
}

const WIDE = new Set(['allowances', 'rates']);
const card = (id, title, ...children) => h('section', { class: 'card' + (WIDE.has(id) ? ' wide' : ''), id: id ? 'sec-' + id : null }, h('h2', null, title), ...children);
const curSelect = (value, onChange, extra = []) => {
  const list = [...new Set([...currencies(settings()), ...extra, value].filter(Boolean))].sort((a, b) => (a === 'CHF' ? -1 : b === 'CHF' ? 1 : a.localeCompare(b)));
  return h('select', { onchange: (e) => onChange(e.target.value) }, list.map((c) => h('option', { value: c, selected: c === value }, c)));
};

// ---------- Neue Reise ----------
function newTripCard() {
  const today = todayStr();
  const d = { name: '', start: addDays(today, 30), end: addDays(today, 44), currency: 'CHF', travelers: 2 };
  const err = h('p', { class: 'form-error' });
  return h('section', { class: 'card highlight', id: 'sec-new' },
    h('h2', null, 'Neue Reise'),
    h('form', { class: 'form-grid', onsubmit: async (e) => {
      e.preventDefault();
      try {
        const r = await api('POST', '/api/trips', d);
        state.data.trips.push(r.trip);
        selectTrip(r.trip.id);
        location.hash = 'plan';
        toast('Reise angelegt – Pauschalen für Essen und Unterkunft sind vorbelegt.');
      } catch (ex) {
        err.textContent = ex.message;
      }
    } },
      h('label', { class: 'span2' }, 'Name', h('input', { required: true, placeholder: 'z.B. Japan 2027', oninput: (e) => (d.name = e.target.value) })),
      h('label', null, 'Von', h('input', { type: 'date', value: d.start, required: true, onchange: (e) => (d.start = e.target.value) })),
      h('label', null, 'Bis', h('input', { type: 'date', value: d.end, required: true, onchange: (e) => (d.end = e.target.value) })),
      h('label', null, 'Währung vor Ort', curSelect(d.currency, (v) => (d.currency = v), state.data.knownCurrencies)),
      h('label', null, 'Personen', h('input', { type: 'number', min: 1, max: 50, value: d.travelers, onchange: (e) => (d.travelers = Number(e.target.value)) })),
      err,
      h('div', { class: 'span2 row gap' }, h('button', { class: 'btn primary', type: 'submit' }, 'Reise anlegen'), state.data.trips.length ? h('button', { class: 'btn ghost', type: 'button', onclick: () => render() }, 'Abbrechen') : null)
    ),
    h('p', { class: 'hint' }, 'Tipp: Eine bestehende Reise lässt sich auch als Vorlage kopieren (unten bei «Reise»). Neue Währungen werden automatisch in die Kursliste übernommen.')
  );
}

// ---------- Reise ----------
function tripCard(t) {
  const d = { name: t.name, start: t.start, end: t.end, currency: t.currency, travelers: t.travelers, note: t.note || '' };
  const err = h('p', { class: 'form-error' });
  return card('trip', 'Reise',
    h('form', { class: 'form-grid', onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      const outside = t.items.filter((it) => it.date < d.start || it.date > d.end).length;
      if (outside && !(await confirmDialog('Reisedaten ändern', `${outside} Posten liegen ausserhalb der neuen Daten. Sie bleiben erhalten, erscheinen aber nicht mehr im Tagesplan. Trotzdem ändern?`, 'Ändern'))) return;
      try {
        await ensureRate(d.currency);
        await saveTripMeta(d);
        render();
        toast('Reise gespeichert');
      } catch (ex) {
        err.textContent = ex.message;
      }
    } },
      h('label', { class: 'span2' }, 'Name', h('input', { value: d.name, required: true, oninput: (e) => (d.name = e.target.value) })),
      h('label', null, 'Von', h('input', { type: 'date', value: d.start, onchange: (e) => (d.start = e.target.value) })),
      h('label', null, 'Bis', h('input', { type: 'date', value: d.end, onchange: (e) => (d.end = e.target.value) })),
      h('label', null, 'Währung vor Ort', curSelect(d.currency, (v) => (d.currency = v), state.data.knownCurrencies)),
      h('label', null, t.split?.enabled ? 'Personen (aus Aufteilung)' : 'Personen (für «pro Person»)', h('input', { type: 'number', min: 1, max: 50, value: t.split?.enabled ? t.split.participants.length : d.travelers, disabled: !!t.split?.enabled, onchange: (e) => (d.travelers = Number(e.target.value)) })),
      h('label', { class: 'span2' }, 'Notiz', h('textarea', { rows: 2, oninput: (e) => (d.note = e.target.value) }, d.note)),
      err,
      h('div', { class: 'span2' }, h('button', { class: 'btn primary', type: 'submit' }, 'Speichern'))
    ),
    h('div', { class: 'row gap wrap sep' },
      h('button', { class: 'btn', onclick: () => copyDialog(t) }, 'Als Vorlage kopieren …'),
      h('button', { class: 'btn', onclick: async () => { await saveTripMeta({ archived: !t.archived }); render(); toast(t.archived ? 'Archiviert' : 'Wieder aktiv'); } }, t.archived ? 'Aus Archiv holen' : 'Archivieren'),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!(await confirmDialog('Reise löschen', `«${t.name}» mit allen ${t.items.length} Posten und Belegen endgültig löschen? (Die tägliche Sicherung bleibt 30 Tage erhalten.)`, 'Löschen', true))) return;
        await api('DELETE', '/api/trips/' + t.id);
        state.data.trips = state.data.trips.filter((x) => x.id !== t.id);
        state.tripId = null;
        await reload();
        render();
        toast('Reise gelöscht');
      } }, 'Löschen')
    )
  );
}

/** Neue Reisewährung ohne Kurs: nach dem Kurs fragen */
async function ensureRate(cur) {
  const S = settings();
  if (cur === 'CHF' || S.rates[cur]) return;
  const v = { rate: '' };
  const r = await modal(`Kurs für ${cur}`, h('div', null,
    h('p', null, `Wie viel CHF ist 1 ${cur}? (wird bei Internetverbindung automatisch aktualisiert)`),
    h('input', { inputmode: 'decimal', placeholder: 'z.B. 0.0058', oninput: (e) => (v.rate = Number(e.target.value.replace(',', '.'))) })
  ), [{ label: 'Später', value: null }, { label: 'Übernehmen', primary: true, value: 'ok' }]);
  const rates = { ...S.rates, [cur]: { rate: r === 'ok' && v.rate > 0 ? v.rate : 1, source: r === 'ok' && v.rate > 0 ? 'manuell' : 'fehlt – bitte erfassen' } };
  const res = await api('PUT', '/api/settings', { rates });
  state.data.settings = res.settings;
  if (state.data.autoRates) api('POST', '/api/rates/refresh').then((x) => { state.data.settings = x.settings; }).catch(() => {});
}

async function copyDialog(t) {
  const len = daysBetween(t.start, t.end);
  const d = { name: t.name.replace(/\d{4}/, (y) => String(Number(y) + 1)), start: addDays(t.start, 364), keepItems: true };
  if (d.name === t.name) d.name = t.name + ' (Kopie)';
  const endInfo = h('span', { class: 'muted small' });
  const upd = () => (endInfo.textContent = isDate(d.start) ? `bis ${fmtDay(addDays(d.start, len))}${addDays(d.start, len).slice(0, 4)}` : '');
  upd();
  const r = await modal('Reise als Vorlage kopieren', h('div', { class: 'form-grid' },
    h('label', { class: 'span2' }, 'Name', h('input', { value: d.name, oninput: (e) => (d.name = e.target.value) })),
    h('label', null, 'Neuer Start', h('input', { type: 'date', value: d.start, onchange: (e) => { d.start = e.target.value; upd(); } }), endInfo),
    h('label', { class: 'check span2' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => (d.keepItems = e.target.checked) }), 'Posten, Tagesprogramm und To-dos übernehmen (ohne Zahlungen und Belege)'),
    h('p', { class: 'hint span2' }, 'Pauschalen, Währung und Teilnehmende werden immer übernommen. Alle Daten werden auf den neuen Start verschoben.')
  ), [{ label: 'Abbrechen', value: null }, { label: 'Kopieren', primary: true, value: 'ok' }]);
  if (r !== 'ok') return;
  const res = await api('POST', `/api/trips/${t.id}/copy`, d);
  state.data.trips.push(res.trip);
  selectTrip(res.trip.id);
  location.hash = 'plan';
  toast('Kopie angelegt');
}

// ---------- Pauschalen ----------
function allowanceCard(t) {
  const list = structuredClone(t.allowances || []);
  const S = settings();
  const body = h('div', { class: 'allow-list' });
  const draw = () => body.replaceChildren(...list.map((a, i) => h('div', { class: 'allow-row' },
    h('label', { class: 'a-label' }, 'Bezeichnung', h('input', { value: a.label, oninput: (e) => (a.label = e.target.value) })),
    h('label', null, 'Kategorie', h('select', { onchange: (e) => (a.catId = e.target.value) }, S.categories.map((c) => h('option', { value: c.id, selected: c.id === a.catId }, c.name)))),
    h('label', null, 'Betrag', h('div', { class: 'row gap' },
      h('input', { class: 'num', inputmode: 'decimal', value: a.amount, oninput: (e) => (a.amount = Number(e.target.value.replace(',', '.')) || 0) }),
      curSelect(a.currency, (v) => (a.currency = v)))),
    h('label', null, 'gilt', h('select', { onchange: (e) => (a.per = e.target.value) }, h('option', { value: 'tag', selected: a.per !== 'nacht' }, 'pro Tag'), h('option', { value: 'nacht', selected: a.per === 'nacht' }, 'pro Nacht'))),
    h('label', null, 'Art', h('select', { onchange: (e) => (a.mode = e.target.value) },
      h('option', { value: 'tag', selected: a.mode !== 'platzhalter' }, 'Tagesbudget'),
      h('option', { value: 'platzhalter', selected: a.mode === 'platzhalter' }, 'Platzhalter'))),
    h('button', { class: 'icon-btn sm', 'aria-label': 'entfernen', onclick: () => { list.splice(i, 1); draw(); } }, '✕')
  )));
  draw();
  return card('allowances', 'Pauschalen',
    h('p', { class: 'muted small' }, h('strong', null, 'Tagesbudget'), ': gilt jeden Tag; erfasste Ausgaben der Kategorie werden angerechnet (Plan vs. Ist). ', h('strong', null, 'Platzhalter'), ': gilt nur, bis ein echter Posten der Kategorie existiert (z.B. Unterkunft noch nicht gebucht). Einzelne Tage lassen sich im Plan über ✎ ausschalten.'),
    body,
    h('div', { class: 'row gap' },
      h('button', { class: 'btn dashed', onclick: () => { list.push({ id: uid(), label: 'Neue Pauschale', catId: 'sonstiges', amount: 0, currency: 'CHF', mode: 'tag', per: 'tag' }); draw(); } }, '+ Pauschale'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: async () => { await saveTripMeta({ allowances: list }); render(); toast('Pauschalen gespeichert'); } }, 'Speichern'))
  );
}

// ---------- Aufteilung ----------
function splitCard(t) {
  const sp = structuredClone(t.split || { enabled: false, participants: [] });
  if (!sp.participants.length) sp.participants = (state.data.users || []).map((u) => ({ id: uid(), name: u.name }));
  const body = h('div', { class: 'stack' });
  const draw = () => body.replaceChildren(
    ...sp.participants.map((p, i) => h('div', { class: 'row gap' },
      h('input', { value: p.name, 'aria-label': 'Name', oninput: (e) => (p.name = e.target.value) }),
      h('button', { class: 'icon-btn sm', 'aria-label': 'entfernen', onclick: () => { sp.participants.splice(i, 1); draw(); } }, '✕'))),
    h('button', { class: 'btn dashed', onclick: () => { sp.participants.push({ id: uid(), name: '' }); draw(); body.querySelector('.row:last-of-type input')?.focus(); } }, '+ Person')
  );
  draw();
  const peopleBox = h('div', { hidden: !sp.enabled }, h('span', { class: 'label' }, 'Teilnehmende'), body);
  return card('split', 'Kostenaufteilung',
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: sp.enabled, onchange: (e) => { sp.enabled = e.target.checked; peopleBox.hidden = !sp.enabled; } }), 'Kosten auf mehrere Personen aufteilen'),
    h('p', { class: 'muted small' }, 'Nur bei Bedarf, z.B. wenn Freunde mitreisen. Pro Zahlung wird erfasst, wer bezahlt hat; pro Posten, wie er aufgeteilt wird (Standard: gleichmässig). Die Auswertung zeigt, wer wem wie viel schuldet.'),
    peopleBox,
    h('div', null, h('button', { class: 'btn primary', onclick: async () => {
      sp.participants = sp.participants.filter((p) => p.name.trim());
      if (sp.enabled && sp.participants.length < 2) return toast('Mindestens zwei Personen erfassen', { error: true });
      await saveTripMeta({ split: sp, travelers: sp.enabled ? sp.participants.length : t.travelers });
      // Bisherige Zahlungen ohne «bezahlt von» zuordnen
      const open = sp.enabled ? t.items.reduce((a, it) => a + (it.payments || []).filter((x) => !x.paidBy).length, 0) : 0;
      if (open) {
        const sel = h('select', null, t.split.participants.map((x) => h('option', { value: x.id }, x.name)));
        const r = await modal('Bisherige Zahlungen', h('div', null,
          h('p', null, `${open} Zahlungen haben noch keine Angabe, wer bezahlt hat. Wem sollen sie zugeordnet werden?`),
          h('label', null, 'Bezahlt von', sel),
          h('p', { class: 'hint' }, 'Einzelne Zahlungen lassen sich danach beim Posten ändern.')
        ), [{ label: 'Später', value: null }, { label: 'Zuordnen', primary: true, value: 'ok' }]);
        if (r === 'ok') {
          const res = await api('POST', `/api/trips/${t.id}/assign-payer`, { paidBy: sel.value });
          Object.assign(t, res.trip);
        }
      }
      render();
      toast('Aufteilung gespeichert');
    } }, 'Speichern'))
  );
}

// ---------- Alle Reisen ----------
function tripsCard() {
  const S = settings();
  const today = todayStr();
  const list = [...state.data.trips].sort((a, b) => b.start.localeCompare(a.start));
  return card('trips', 'Reisen',
    list.length ? h('ul', { class: 'trip-list' }, list.map((t) => {
      const s = tripSummary(S, t, today);
      return h('li', { class: (t.id === state.tripId ? 'on' : '') + (t.archived ? ' archived' : '') },
        h('button', { class: 'link-like', onclick: () => { selectTrip(t.id); location.hash = 'plan'; } },
          h('strong', null, t.name), h('span', { class: 'muted small' }, ` ${fmtDate(t.start)} – ${fmtDate(t.end)}${t.archived ? ' · archiviert' : ''}`)),
        h('span', { class: 'num' }, 'CHF ' + fmt0(s.forecast)));
    })) : h('p', { class: 'empty' }, 'Noch keine Reise.'),
    h('button', { class: 'btn', onclick: () => { state.params = { newTrip: true }; render(); window.scrollTo(0, 0); } }, '+ Neue Reise')
  );
}

// ---------- Excel-Import ----------
function importCard() {
  const out = h('div');
  const input = h('input', { type: 'file', class: 'file-input', accept: '.xlsx,.xlsm', onchange: async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    out.replaceChildren(h('p', { class: 'muted' }, 'Wird gelesen …'));
    try {
      const prev = await api('POST', '/api/import/excel', f);
      showPreview(prev);
    } catch (ex) {
      out.replaceChildren(h('p', { class: 'form-error' }, ex.message));
    }
  } });
  const showPreview = (prev) => {
    const r = prev.report;
    const tmpSettings = { ...settings(), rates: { ...Object.fromEntries(Object.entries(prev.settingsPatch.rates).map(([k, v]) => [k, { rate: v }])), ...settings().rates } };
    const sum = tripSummary(tmpSettings, prev.trip, '0000-01-01');
    const name = h('input', { value: prev.trip.name });
    const diff = Math.abs(sum.forecast - (r.excelTotal || 0));
    out.replaceChildren(h('div', { class: 'import-preview' },
      h('label', null, 'Name der Reise', name),
      h('dl', { class: 'facts' },
        h('dt', null, 'Zeitraum'), h('dd', null, `${fmtDate(prev.trip.start)} – ${fmtDate(prev.trip.end)}`),
        h('dt', null, 'Posten / Unterkünfte'), h('dd', null, `${r.items} / ${r.stays}`),
        h('dt', null, 'Zahlungen'), h('dd', null, r.payments),
        h('dt', null, 'Prognose Reisli'), h('dd', null, 'CHF ' + fmt(sum.forecast)),
        h('dt', null, 'Total laut Excel'), h('dd', { class: diff > 1 ? 'neg' : 'pos' }, 'CHF ' + fmt(r.excelTotal) + (diff > 1 ? ' ⚠' : ' ✓')),
        h('dt', null, 'Bezahlt'), h('dd', null, 'CHF ' + fmt(sum.paid))
      ),
      r.excelPaid && Math.abs(r.excelPaid - sum.paid) > 1 ? h('p', { class: 'hint' }, `Die Excel zeigt «bereits bezahlt» CHF ${fmt(r.excelPaid)} – sie zählt auch reservierte Posten mit Bezahlmethode. Reisli zählt nur echte Zahlungen.`) : null,
      r.warnings.length ? h('ul', { class: 'warn-list' }, r.warnings.map((w) => h('li', null, w))) : null,
      h('div', { class: 'row gap' },
        h('button', { class: 'btn primary', onclick: async () => {
          try {
            const res = await api('POST', '/api/import/commit', { trip: { ...prev.trip, name: name.value.trim() || prev.trip.name }, settingsPatch: prev.settingsPatch });
            await reload();
            selectTrip(res.trip.id);
            location.hash = 'plan';
            const a = res.added || {};
            toast(`Importiert${a.methods?.length ? ` · ${a.methods.length} Bezahlmethoden` : ''}${a.rates?.length ? ` · Kurse ${a.rates.join(', ')}` : ''}`, { duration: 5000 });
          } catch (ex) {
            toast(ex.message, { error: true });
          }
        } }, 'Reise übernehmen'),
        h('button', { class: 'btn ghost', onclick: () => out.replaceChildren() }, 'Verwerfen')
      )
    ));
  };
  return card('import', 'Excel importieren',
    h('p', { class: 'muted small' }, 'Übernimmt eine Reise aus der bisherigen Ferien-Excel (Blätter «Übersicht», «Reiseablauf», «Abrechnung» …). Du siehst zuerst eine Vorschau mit Abgleich gegen das Excel-Total. Die Datei wird nicht gespeichert.'),
    h('label', { class: 'btn file-btn' }, 'Excel-Datei wählen …', input),
    out
  );
}

// ---------- Bezahlmethoden & Kategorien ----------
function listEditor(id, title, hint, items, fields, onSave, newItem) {
  const list = structuredClone(items);
  const body = h('div', { class: 'stack' });
  const draw = () => body.replaceChildren(...list.map((x, i) => h('div', { class: 'row gap' },
    fields.map((f) => f(x)),
    h('button', { class: 'icon-btn sm', 'aria-label': 'nach oben', disabled: i === 0, onclick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); } }, '↑'),
    h('button', { class: 'icon-btn sm', 'aria-label': 'entfernen', onclick: () => { list.splice(i, 1); draw(); } }, '✕')
  )));
  draw();
  return card(id, title,
    hint ? h('p', { class: 'muted small' }, hint) : null,
    body,
    h('div', { class: 'row gap' },
      h('button', { class: 'btn dashed', onclick: () => { list.push(newItem()); draw(); body.lastChild?.querySelector('input')?.focus(); } }, '+ Hinzufügen'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: async () => {
        try {
          await onSave(list);
          render();
          toast('Gespeichert');
        } catch (ex) {
          toast(ex.message, { error: true });
        }
      } }, 'Speichern'))
  );
}

async function saveSettings(patch) {
  const res = await api('PUT', '/api/settings', patch);
  state.data.settings = res.settings;
}

function methodsCard() {
  return listEditor('methods', 'Bezahlmethoden', 'Frei definierbar, z.B. Kreditkarten und Konten. Bestehende Zahlungen behalten ihre Methode auch nach dem Umbenennen.',
    settings().methods,
    [(m) => h('input', { value: m.name, 'aria-label': 'Name', oninput: (e) => (m.name = e.target.value) })],
    (list) => saveSettings({ methods: list.filter((m) => m.name.trim()) }),
    () => ({ id: uid(), name: '' }));
}

function categoriesCard() {
  return listEditor('categories', 'Kategorien', 'Für Auswertung und Farben. Gelöschte Kategorien erscheinen bei bestehenden Posten als «Sonstiges».',
    settings().categories,
    [
      (c) => h('input', { type: 'color', value: c.color, 'aria-label': 'Farbe', oninput: (e) => (c.color = e.target.value) }),
      (c) => h('input', { value: c.name, 'aria-label': 'Name', oninput: (e) => (c.name = e.target.value) }),
    ],
    (list) => saveSettings({ categories: list.filter((c) => c.name.trim()) }),
    () => ({ id: uid(), name: '', color: '#64748b' }));
}

// ---------- Währungen & Kurse ----------
function ratesCard() {
  const S = settings();
  const rates = structuredClone(S.rates || {});
  const body = h('tbody');
  const draw = () => body.replaceChildren(...Object.keys(rates).sort().map((cur) => {
    const r = rates[cur];
    const inv = h('span', { class: 'muted small' }, r.rate ? `1 CHF = ${fmtCur(1 / r.rate)} ${cur}` : '');
    return h('tr', null,
      h('th', null, cur),
      h('td', null, h('input', { class: 'num rate', inputmode: 'decimal', value: r.rate, 'aria-label': `CHF pro ${cur}`, oninput: (e) => { r.rate = Number(e.target.value.replace(',', '.')) || 0; r.source = 'manuell'; inv.textContent = r.rate ? `1 CHF = ${fmtCur(1 / r.rate)} ${cur}` : ''; } }), inv),
      h('td', { class: 'muted small' }, r.source || '', r.updatedAt ? ' · ' + fmtDate(r.updatedAt.slice(0, 10)) : ''),
      h('td', null, h('label', { class: 'check small', title: 'Fixiert: wird nicht automatisch aktualisiert' }, h('input', { type: 'checkbox', checked: !!r.locked, onchange: (e) => (r.locked = e.target.checked) }), 'fix')),
      h('td', null, h('button', { class: 'icon-btn sm', 'aria-label': 'entfernen', onclick: () => { delete rates[cur]; draw(); } }, '✕'))
    );
  }));
  draw();
  const add = h('input', { list: 'known-cur', placeholder: 'z.B. JPY', maxlength: 3, class: 'short' });
  return card('rates', 'Währungen & Kurse',
    h('p', { class: 'muted small' }, 'Kurs = CHF pro Einheit. Die Planbeträge werden laufend zum aktuellen Kurs gerechnet; bereits bezahlte Beträge behalten ihren effektiven CHF-Wert. ',
      state.data.autoRates ? 'Kurse werden täglich automatisch geholt (EZB), ausser «fix».' : 'Automatische Kurse sind ausgeschaltet.'),
    h('div', { class: 'table-scroll' }, h('table', { class: 'simple rates' }, h('thead', null, h('tr', null, h('th', null, 'Währung'), h('th', null, 'CHF pro Einheit'), h('th', null, 'Quelle'), h('th'), h('th'))), body)),
    h('div', { class: 'row gap wrap' },
      add, h('datalist', { id: 'known-cur' }, (state.data.knownCurrencies || []).map((c) => h('option', { value: c }))),
      h('button', { class: 'btn', onclick: () => {
        const c = add.value.trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(c) || c === 'CHF') return toast('Dreistelliger Währungscode, z.B. JPY', { error: true });
        rates[c] ||= { rate: 0, source: 'manuell' };
        add.value = '';
        draw();
      } }, '+ Währung'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: async (e) => {
        e.target.disabled = true;
        try {
          await saveSettings({ rates: Object.fromEntries(Object.entries(rates).filter(([, r]) => r.rate > 0)) });
          const r = await api('POST', '/api/rates/refresh');
          state.data.settings = r.settings;
          render();
          toast(`Kurse vom ${fmtDate(r.date)} geholt${r.missing?.length ? ` · nicht verfügbar: ${r.missing.join(', ')}` : ''}`, { duration: 5000 });
        } catch (ex) {
          toast(ex.message, { error: true, duration: 6000 });
          e.target.disabled = false;
        }
      } }, '↻ Kurse holen'),
      h('button', { class: 'btn primary', onclick: async () => {
        const missing = Object.entries(rates).filter(([, r]) => !(r.rate > 0)).map(([c]) => c);
        if (missing.length) return toast('Kurs fehlt für ' + missing.join(', '), { error: true });
        await saveSettings({ rates });
        render();
        toast('Kurse gespeichert');
      } }, 'Speichern')
    )
  );
}

// ---------- Benutzer ----------
function usersCard() {
  const nu = { name: '', password: '' };
  const pw = { oldPassword: '', newPassword: '' };
  return card('users', 'Benutzer',
    h('ul', { class: 'plain-list' }, state.data.users.map((u) => h('li', null, u.name,
      u.id === state.data.user.id ? h('span', { class: 'muted small' }, 'du') : h('button', { class: 'link', onclick: async () => {
        if (!(await confirmDialog('Benutzer löschen', `${u.name} löschen?`, 'Löschen', true))) return;
        await api('DELETE', '/api/users/' + u.id);
        await reload();
        render();
      } }, 'löschen')))),
    h('form', { class: 'form-grid', onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/api/users', nu);
        await reload();
        render();
        toast('Benutzer angelegt');
      } catch (ex) {
        toast(ex.message, { error: true });
      }
    } },
      h('label', null, 'Name', h('input', { required: true, autocomplete: 'off', oninput: (e) => (nu.name = e.target.value) })),
      h('label', null, 'Passwort', h('input', { type: 'password', minlength: 8, required: true, autocomplete: 'new-password', oninput: (e) => (nu.password = e.target.value) })),
      h('div', { class: 'span2' }, h('button', { class: 'btn', type: 'submit' }, '+ Person hinzufügen'))
    ),
    h('details', null, h('summary', null, 'Eigenes Passwort ändern'),
      h('form', { class: 'form-grid', onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api('POST', '/api/password', pw);
          e.target.reset();
          toast('Passwort geändert');
        } catch (ex) {
          toast(ex.message, { error: true });
        }
      } },
        h('label', null, 'Aktuell', h('input', { type: 'password', required: true, autocomplete: 'current-password', oninput: (e) => (pw.oldPassword = e.target.value) })),
        h('label', null, 'Neu', h('input', { type: 'password', minlength: 8, required: true, autocomplete: 'new-password', oninput: (e) => (pw.newPassword = e.target.value) })),
        h('div', { class: 'span2' }, h('button', { class: 'btn', type: 'submit' }, 'Ändern'))
      ))
  );
}

// ---------- Sicherung ----------
function backupCard() {
  const listEl = h('div', null, h('p', { class: 'muted small' }, 'Lädt …'));
  const loadList = async () => {
    try {
      const { backups } = await api('GET', '/api/backups');
      listEl.replaceChildren(backups.length ? h('ul', { class: 'backup-list' }, backups.slice(0, 20).map((b) => h('li', null,
        h('span', null, h('span', null, b.name.replace(/\.json$/, '')), h('span', { class: 'muted small' }, ` ${fmt0(b.size / 1024)} KB`)),
        h('span', { class: 'row-actions' },
          h('button', { class: 'link', onclick: () => download('/api/backups/' + encodeURIComponent(b.name)) }, 'laden'),
          h('button', { class: 'link', onclick: async () => {
            if (!(await confirmDialog('Wiederherstellen', `Alle Daten durch den Stand «${b.name}» ersetzen? Der aktuelle Stand wird vorher gesichert.`, 'Wiederherstellen', true))) return;
            await api('POST', `/api/backups/${encodeURIComponent(b.name)}/restore`);
            await reload();
            render();
            toast('Wiederhergestellt');
          } }, 'wiederherstellen'))
      ))) : h('p', { class: 'muted small' }, 'Noch keine Sicherungen.'));
    } catch (ex) {
      listEl.replaceChildren(h('p', { class: 'form-error' }, ex.message));
    }
  };
  loadList();
  const restore = h('input', { type: 'file', class: 'file-input', accept: '.json,application/json', onchange: async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    let data;
    try {
      data = JSON.parse(await f.text());
    } catch {
      return toast('Keine gültige JSON-Datei', { error: true });
    }
    if (data.kind === 'trip') {
      if (!(await confirmDialog('Reise einspielen', `Die Reise «${data.trip?.name}» wird zusätzlich angelegt. Bestehende Reisen bleiben unverändert.`, 'Einspielen'))) return;
    } else if (!(await confirmDialog('Sicherung einspielen', `Alle Reisen und Einstellungen werden durch die Sicherung vom ${fmtDate((data.exportedAt || '').slice(0, 10))} ersetzt (${data.trips?.length ?? 0} Reisen). Der aktuelle Stand wird vorher auf dem Server gesichert.`, 'Ersetzen', true))) return;
    try {
      const r = await api('POST', '/api/restore', data);
      await reload();
      if (r.trip) selectTrip(r.trip.id);
      render();
      toast(r.mode === 'trip' ? 'Reise eingespielt' : `Sicherung eingespielt (${r.trips} Reisen${r.files ? `, ${r.files} Belege` : ''})`);
    } catch (ex) {
      toast(ex.message, { error: true });
    }
  } });
  return card('backup', 'Sicherung',
    h('p', { class: 'muted small' }, 'Der Server sichert automatisch einmal täglich (30 Tage). Zusätzlich kannst du jederzeit eine Datei herunterladen – z.B. vor der Abreise aufs Handy oder in die Cloud.'),
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn primary', onclick: () => download('/api/backup') }, '⬇ Sicherung herunterladen'),
      h('button', { class: 'btn', onclick: () => download('/api/backup?files=1') }, '⬇ inkl. Belege'),
      h('label', { class: 'btn file-btn' }, '⬆ Einspielen …', restore)
    ),
    h('div', { class: 'row gap sep' }, h('h3', null, 'Sicherungen auf dem Server'), h('span', { class: 'spacer' }),
      h('button', { class: 'btn small', onclick: async () => { await api('POST', '/api/backups'); loadList(); toast('Sicherung erstellt'); } }, 'Jetzt sichern')),
    listEl
  );
}


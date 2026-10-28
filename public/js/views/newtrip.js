// Fenster «Neue Reise»: leer anlegen, eine bestehende Reise als Vorlage kopieren oder aus der Ferien-Excel übernehmen
import { h, modal, toast, closeDialogOf } from '../ui.js';
import { state, api, reload, settings, selectTrip, go } from '../app.js';
import { fmt, fmtDate, fmtDay, fmtRange, tripSummary, todayStr, addDays, isDate, daysBetween } from '../calc.js';
import { curSelect, ensureRate } from './shared.js';

/** mode: 'leer' | 'kopie' | 'excel'; sourceId: vorgewählte Reise für «kopie» */
export function newTripDialog(mode = 'leer', sourceId = null) {
  const body = h('div', { class: 'newtrip' });
  const segs = h('div', { class: 'segs wide-segs' });
  const MODES = [['leer', 'Leer'], ['kopie', 'Kopie einer Reise'], ['excel', 'Aus Excel']];
  const show = (m) => {
    mode = m;
    segs.replaceChildren(...MODES.filter(([id]) => id !== 'kopie' || state.data.trips.length).map(([id, label]) => h('button', { type: 'button', class: 'seg' + (id === m ? ' on' : ''), onclick: () => show(id) }, label)));
    body.replaceChildren(m === 'kopie' ? copyPane(body, sourceId) : m === 'excel' ? excelPane(body) : emptyPane(body));
    body.querySelector('input:not([type=checkbox]):not([type=file])')?.focus();
  };
  show(mode);
  return modal('Neue Reise', h('div', { class: 'stack' }, segs, body), [{ label: 'Abbrechen', value: null }]);
}

/** Nach dem Anlegen: Fenster schliessen, neue Reise öffnen */
function done(anchor, trip, msg) {
  closeDialogOf(anchor);
  selectTrip(trip.id);
  go('plan');
  toast(msg, { duration: 5000 });
}

// ---------- Leer ----------
function emptyPane(anchor) {
  const today = todayStr();
  const d = { name: '', start: addDays(today, 30), end: addDays(today, 44), currency: 'CHF', travelers: 2 };
  const err = h('p', { class: 'form-error' });
  const endInput = h('input', { type: 'date', value: d.end, required: true, onchange: (e) => (d.end = e.target.value) });
  return h('form', { class: 'form-grid', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    try {
      await ensureRate(d.currency);
      const r = await api('POST', '/api/trips', d);
      state.data.trips.push(r.trip);
      done(anchor, r.trip, 'Reise angelegt – Pauschalen für Essen und Unterkunft sind vorbelegt.');
    } catch (ex) {
      err.textContent = ex.message;
    }
  } },
    h('label', { class: 'span2' }, 'Name', h('input', { required: true, placeholder: 'z.B. Japan', oninput: (e) => (d.name = e.target.value) })),
    h('label', null, 'Von', h('input', { type: 'date', value: d.start, required: true, onchange: (e) => {
      // Dauer beibehalten, wenn der Start verschoben wird
      const len = isDate(d.start) && isDate(d.end) ? daysBetween(d.start, d.end) : 14;
      d.start = e.target.value;
      if (isDate(d.start)) endInput.value = d.end = addDays(d.start, Math.max(0, len));
    } })),
    h('label', null, 'Bis', endInput),
    h('label', null, 'Währung vor Ort', curSelect(d.currency, (v) => (d.currency = v), state.data.knownCurrencies)),
    h('label', null, 'Personen', h('input', { type: 'number', min: 1, max: 50, value: d.travelers, onchange: (e) => (d.travelers = Number(e.target.value)) })),
    h('p', { class: 'hint span2' }, 'Das Jahr muss nicht in den Namen – die Reisedaten erscheinen überall neben dem Namen.'),
    err,
    h('div', { class: 'span2' }, h('button', { class: 'btn primary', type: 'submit' }, 'Reise anlegen'))
  );
}

// ---------- Kopie ----------
function copyPane(anchor, sourceId) {
  const trips = [...state.data.trips].sort((a, b) => b.start.localeCompare(a.start));
  let src = trips.find((t) => t.id === sourceId) || trips.find((t) => t.id === state.tripId) || trips[0];
  const d = { name: '', start: '', keepItems: true };
  const name = h('input', { required: true, oninput: (e) => (d.name = e.target.value) });
  const start = h('input', { type: 'date', required: true, onchange: (e) => { d.start = e.target.value; upd(); } });
  const endInfo = h('span', { class: 'muted small' });
  const upd = () => {
    const len = daysBetween(src.start, src.end);
    endInfo.textContent = isDate(d.start) ? `bis ${fmtDay(addDays(d.start, len))}${addDays(d.start, len).slice(0, 4)} (${len + 1} Tage)` : '';
  };
  const setSource = (t) => {
    src = t;
    name.value = d.name = t.name;
    start.value = d.start = addDays(t.start, 364);
    upd();
  };
  setSource(src);
  const err = h('p', { class: 'form-error' });
  return h('form', { class: 'form-grid', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    try {
      const r = await api('POST', `/api/trips/${src.id}/copy`, d);
      state.data.trips.push(r.trip);
      done(anchor, r.trip, 'Kopie angelegt');
    } catch (ex) {
      err.textContent = ex.message;
    }
  } },
    h('label', { class: 'span2' }, 'Vorlage', h('select', { onchange: (e) => setSource(trips.find((t) => t.id === e.target.value)) },
      trips.map((t) => h('option', { value: t.id, selected: t.id === src.id }, `${t.name} · ${fmtRange(t.start, t.end)}`)))),
    h('label', { class: 'span2' }, 'Name der neuen Reise', name),
    h('label', null, 'Neuer Start', start, endInfo),
    h('label', { class: 'check span2' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => (d.keepItems = e.target.checked) }), 'Posten, Tagesprogramm und To-dos übernehmen (ohne Zahlungen und Belege)'),
    h('p', { class: 'hint span2' }, 'Pauschalen, Währung und Teilnehmende werden immer übernommen. Alle Daten werden auf den neuen Start verschoben.'),
    err,
    h('div', { class: 'span2' }, h('button', { class: 'btn primary', type: 'submit' }, 'Kopie anlegen'))
  );
}

// ---------- Excel ----------
function excelPane(anchor) {
  const out = h('div');
  const input = h('input', { type: 'file', class: 'file-input', accept: '.xlsx,.xlsm', onchange: async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    out.replaceChildren(h('p', { class: 'muted' }, 'Wird gelesen …'));
    try {
      showPreview(await api('POST', '/api/import/excel', f));
    } catch (ex) {
      out.replaceChildren(h('p', { class: 'form-error' }, ex.message));
    }
  } });
  const showPreview = (prev) => {
    const r = prev.report;
    const S = settings();
    const tmpSettings = { ...S, rates: { ...Object.fromEntries(Object.entries(prev.settingsPatch.rates).map(([k, v]) => [k, { rate: v }])), ...S.rates } };
    const sum = tripSummary(tmpSettings, prev.trip, '0000-01-01');
    // Jahr am Ende des Namens weglassen – die Daten stehen ohnehin daneben
    const name = h('input', { value: prev.trip.name.replace(/\s*\d{4}$/, '') || prev.trip.name });
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
        h('button', { type: 'button', class: 'btn primary', onclick: async () => {
          try {
            const res = await api('POST', '/api/import/commit', { trip: { ...prev.trip, name: name.value.trim() || prev.trip.name }, settingsPatch: prev.settingsPatch });
            await reload();
            const a = res.added || {};
            done(anchor, res.trip, `Importiert${a.methods?.length ? ` · ${a.methods.length} Bezahlmethoden` : ''}${a.rates?.length ? ` · Kurse ${a.rates.join(', ')}` : ''}`);
          } catch (ex) {
            toast(ex.message, { error: true });
          }
        } }, 'Reise übernehmen'),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => out.replaceChildren() }, 'Verwerfen')
      )
    ));
  };
  return h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, 'Übernimmt eine Reise aus der bisherigen Ferien-Excel (Blätter «Übersicht», «Reiseablauf», «Abrechnung» …). Du siehst zuerst eine Vorschau mit Abgleich gegen das Excel-Total. Die Datei selbst wird nicht gespeichert.'),
    h('label', { class: 'btn file-btn' }, 'Excel-Datei wählen …', input),
    out
  );
}


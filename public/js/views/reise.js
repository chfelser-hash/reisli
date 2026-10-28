// Ansicht «Reise bearbeiten» (erreichbar über ✎ im Kopf der Reise): Daten, Pauschalen, Aufteilung,
// Kopieren, Archivieren, Löschen. Getrennt von «Mehr», damit nichts mit anderen Reisen vermischt wird.
import { h, modal, toast, confirmDialog } from '../ui.js';
import { state, api, reload, render, trip, settings, saveTripMeta, go } from '../app.js';
import { card, curSelect, ensureRate, uid } from './shared.js';
import { newTripDialog } from './newtrip.js';
import { renderPlan } from './plan.js';

export function renderReise() {
  const t = trip();
  if (!t) return renderPlan();
  const params = state.params || {};
  const view = h('div', { class: 'view reise' },
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn ghost', onclick: () => go('plan') }, '← Zurück zum Plan'),
      h('h1', null, 'Reise bearbeiten: ' + t.name)
    ),
    h('div', { class: 'settings-grid' }, tripCard(t), allowanceCard(t), splitCard(t))
  );
  if (params.section) setTimeout(() => document.getElementById('sec-' + params.section)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  state.params = {};
  return view;
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
      h('button', { class: 'btn', onclick: () => newTripDialog('kopie', t.id) }, 'Als Vorlage kopieren …'),
      h('button', { class: 'btn', onclick: async () => { await saveTripMeta({ archived: !t.archived }); render(); toast(t.archived ? 'Archiviert' : 'Wieder aktiv'); } }, t.archived ? 'Aus Archiv holen' : 'Archivieren'),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!(await confirmDialog('Reise löschen', `«${t.name}» mit allen ${t.items.length} Posten und Belegen endgültig löschen? (Die tägliche Sicherung bleibt 30 Tage erhalten.)`, 'Löschen', true))) return;
        await api('DELETE', '/api/trips/' + t.id);
        state.data.trips = state.data.trips.filter((x) => x.id !== t.id);
        state.tripId = null;
        await reload();
        go('plan');
        toast('Reise gelöscht');
      } }, 'Löschen')
    )
  );
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

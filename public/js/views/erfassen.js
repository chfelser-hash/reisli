// Ansicht «Erfassen»: Unterwegs-Modus – Ausgaben in Sekunden erfassen (Betrag in Lokalwährung, Kategorie, fertig)
import { h, chips, toast } from '../ui.js';
import { state, trip, settings, saveItem, deleteItem, render, tripCurrencies, hasRate, personName, methodName } from '../app.js';
import { evalExpr, itemCalc, fmt, fmt0, fmtCur, toCHF, round2, todayStr, fmtDay, dayNumber, tripSummary, isStay, stayFor } from '../calc.js';
import { editItem, catDot } from './item.js';
import { renderPlan } from './plan.js';
import { timeline } from './timeline.js';

// Eingaben überleben ein Neuzeichnen (z.B. nach dem Speichern)
const draft = { date: null, cur: null, catId: 'essen', methodId: null, paid: true, paidBy: null, members: null, amount: '', title: '' };
const remember = (k, v) => { try { localStorage.setItem('reisli.' + k, v); } catch { /* egal */ } };
const recall = (k) => { try { return localStorage.getItem('reisli.' + k); } catch { return null; } };

export function renderErfassen() {
  const t = trip();
  if (!t) return renderPlan();
  const S = settings();
  const today = todayStr();
  const inTrip = today >= t.start && today <= t.end;
  if (!draft.date || draft.date < t.start || draft.date > t.end) draft.date = inTrip ? today : t.start;
  draft.cur ||= recall('cur.' + t.id) || t.currency || 'CHF';
  draft.methodId ??= recall('method') || '';
  const parts = t.split?.enabled ? t.split.participants : [];
  draft.paidBy ||= parts[0]?.id || '';
  draft.members ||= parts.map((p) => p.id);

  // ----- Formular -----
  const preview = h('span', { class: 'amount-preview' });
  const amount = h('input', {
    class: 'amount-input', inputmode: 'decimal', placeholder: '0', autocomplete: 'off', 'aria-label': 'Betrag',
    oninput: () => {
      const v = evalExpr(amount.value);
      amount.classList.toggle('invalid', Number.isNaN(v));
      updatePreview();
      draft.amount = amount.value;
      state.busy = !!amount.value;
    },
  });
  amount.value = draft.amount;
  const updatePreview = () => {
    const v = evalExpr(amount.value);
    preview.textContent = draft.cur !== 'CHF' && v ? (hasRate(draft.cur) ? '≈ CHF ' + fmt(toCHF(S, v, draft.cur)) : 'Kurs fehlt') : '';
  };
  const curChips = chips(tripCurrencies().slice(0, 4).map((c) => ({ value: c, label: c })), draft.cur, (v) => { draft.cur = v; remember('cur.' + t.id, v); updatePreview(); }, 'small');

  const titles = [...new Set(t.items.map((it) => it.title))].slice(-80);
  const listId = 'titles-' + t.id;
  const title = h('input', { placeholder: 'Wofür? (leer = Kategorie)', list: listId, autocomplete: 'off', value: draft.title, oninput: (e) => (draft.title = e.target.value) });

  // Schnellknöpfe: die häufigsten unterwegs erfassten Ausgaben dieser Reise
  const catChips = chips(S.categories.map((c) => ({ value: c.id, label: c.name, color: c.color })), draft.catId, (v) => (draft.catId = v), 'small cats');
  const favs = favorites(t);
  const quickBox = favs.length ? h('div', { class: 'field' },
    h('span', { class: 'label' }, 'Schnell'),
    h('div', { class: 'chips' }, favs.map((f) => h('button', { type: 'button', class: 'chip fav', style: { '--c': S.categories.find((c) => c.id === f.catId)?.color }, onclick: () => {
      title.value = draft.title = f.title;
      draft.catId = f.catId;
      catChips.setValue(f.catId);
      amount.focus();
    } }, f.title)))
  ) : null;

  const paidBox = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: draft.paid, onchange: (e) => { draft.paid = e.target.checked; methodWrap.hidden = !draft.paid; } }), 'schon bezahlt');
  const methodWrap = h('div', { class: 'field', hidden: !draft.paid },
    h('span', { class: 'label' }, 'Bezahlt mit'),
    chips([{ value: '', label: '—' }, ...S.methods.map((m) => ({ value: m.id, label: m.name }))], draft.methodId, (v) => { draft.methodId = v; remember('method', v); }, 'small'),
    parts.length ? h('span', { class: 'label' }, 'Bezahlt von') : null,
    parts.length ? chips(parts.map((p) => ({ value: p.id, label: p.name })), draft.paidBy, (v) => (draft.paidBy = v), 'small') : null
  );
  const forWhom = parts.length ? h('div', { class: 'field' },
    h('span', { class: 'label' }, 'Für'),
    h('div', { class: 'chips' }, parts.map((p) => h('label', { class: 'check chip-check' },
      h('input', { type: 'checkbox', checked: draft.members.includes(p.id), onchange: (e) => (draft.members = e.target.checked ? [...new Set([...draft.members, p.id])] : draft.members.filter((x) => x !== p.id)) }), p.name)))
  ) : null;

  const err = h('p', { class: 'form-error', role: 'alert' });
  const form = h('form', {
    class: 'card entry',
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      const v = round2(evalExpr(amount.value));
      if (!v || Number.isNaN(v)) {
        err.textContent = 'Bitte einen Betrag eingeben.';
        amount.focus();
        return;
      }
      const catName = S.categories.find((c) => c.id === draft.catId)?.name || 'Ausgabe';
      const cur = draft.cur;
      const item = {
        date: draft.date, title: title.value.trim() || catName, catId: draft.catId, detail: '', place: '', time: '',
        plan: { amount: v, currency: cur }, payWhere: 'vorort', reserved: false,
        payments: draft.paid ? [{ date: draft.date, amount: v, currency: cur, chf: hasRate(cur) ? round2(toCHF(S, v, cur)) : null, methodId: draft.methodId, paidBy: parts.length ? draft.paidBy : '', note: '' }] : [],
        split: parts.length && draft.members.length && draft.members.length < parts.length ? { mode: 'equal', members: draft.members, values: {} } : null,
        todos: [], files: [], link: '', note: '',
      };
      try {
        const saved = await saveItem(item);
        draft.amount = draft.title = '';
        state.busy = false;
        render();
        toast(`${fmtCur(v, cur)} · ${item.title} gespeichert`, { action: { label: 'Rückgängig', fn: async () => { await deleteItem(saved.id); render(); } } });
        setTimeout(() => document.querySelector('.amount-input')?.focus(), 50);
      } catch (ex) {
        err.textContent = ex.message;
      }
    },
  },
    h('div', { class: 'entry-head' }, h('h2', null, 'Ausgabe erfassen'), h('span', { class: 'muted' }, `${fmtDay(draft.date)} · Tag ${dayNumber(t, draft.date)}`)),
    h('div', { class: 'amount-row' }, amount, preview),
    curChips,
    quickBox,
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Kategorie'), catChips),
    h('div', { class: 'field' }, title, h('datalist', { id: listId }, titles.map((x) => h('option', { value: x })))),
    h('div', { class: 'field' }, paidBox),
    methodWrap,
    forWhom,
    err,
    h('button', { class: 'btn primary big block', type: 'submit' }, 'Speichern')
  );

  const sum = tripSummary(S, t, today);
  return h('div', { class: 'view erfassen' },
    timeline(t, sum, draft.date, (d) => { draft.date = d; render(); }),
    h('div', { class: 'cols' }, h('div', { class: 'col-form' }, form), dayPanel(t, draft.date, today)));
}

/** Häufigste unterwegs erfasste Ausgaben (Titel + Kategorie), höchstens 6 */
function favorites(t) {
  const map = new Map();
  for (const it of t.items) {
    if (isStay(it) || !(it.payments || []).some((p) => p.date)) continue;
    const k = it.title.trim().toLowerCase() + '|' + it.catId;
    const e = map.get(k) || { title: it.title.trim(), catId: it.catId, n: 0, last: '' };
    e.n++;
    if ((it.createdAt || '') > e.last) e.last = it.createdAt || '';
    map.set(k, e);
  }
  const cats = new Set(settings().categories.map((c) => c.name.toLowerCase()));
  return [...map.values()].filter((e) => !cats.has(e.title.toLowerCase()) || e.n > 1).sort((a, b) => b.n - a.n || b.last.localeCompare(a.last)).slice(0, 6);
}

/** Rechte Spalte: was an diesem Tag schon erfasst ist, inkl. Tagesbudget */
function dayPanel(t, d, today) {
  const S = settings();
  const sum = tripSummary(S, t, today);
  const items = t.items.filter((it) => !isStay(it) && it.date === d).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const stay = stayFor(t, d);
  const allow = (sum.allow.get(d) || []).filter((x) => x.allowance.mode === 'tag');
  const costs = sum.byDay.get(d) || { total: 0, allowance: 0 };
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, fmtDay(d)), h('span', { class: 'muted' }, 'CHF ' + fmt0(costs.total + costs.allowance))),
    allow.length ? h('div', { class: 'budget-tiles' }, allow.map((x) => {
      const pct = x.budgetCHF ? Math.min(100, (x.actualCHF / x.budgetCHF) * 100) : 0;
      const over = x.actualCHF > x.budgetCHF;
      return h('div', { class: 'budget-tile' + (over ? ' over' : '') },
        h('span', { class: 'kl' }, x.allowance.label),
        h('span', { class: 'kv' }, fmt0(x.actualCHF), h('small', null, ` / ${fmt0(x.budgetCHF)} CHF`)),
        h('span', { class: 'bar' + (over ? ' over' : '') }, h('span', { style: { width: pct + '%', '--c': S.categories.find((c) => c.id === x.allowance.catId)?.color } })),
        h('span', { class: 'small muted' }, over ? `${fmt0(x.actualCHF - x.budgetCHF)} über Budget` : `noch ${fmt0(x.budgetCHF - x.actualCHF)} übrig`)
      );
    })) : null,
    stay ? h('p', { class: 'muted small' }, '🛏 ', stay.title) : null,
    items.length
      ? h('ul', { class: 'tx-list' }, items.map((it) => {
          const c = itemCalc(S, it);
          const p = it.payments?.[0];
          return h('li', null, h('button', { class: 'tx', onclick: () => editItem(it) },
            catDot(it.catId),
            h('span', { class: 'tx-main' },
              h('span', { class: 'tx-note' }, it.title),
              h('span', { class: 'tx-meta' }, [c.label, p?.methodId ? methodName(p.methodId) : '', p?.paidBy ? personName(p.paidBy) : ''].filter(Boolean).join(' · '))
            ),
            h('span', { class: 'tx-amt' }, it.plan.currency === 'CHF' ? fmt(c.totalCHF) : h('span', { class: 'two' }, h('span', null, fmtCur(it.plan.amount, it.plan.currency)), h('small', null, 'CHF ' + fmt(c.totalCHF))))
          ));
        }))
      : h('p', { class: 'empty' }, 'Für diesen Tag ist noch nichts erfasst.')
  );
}

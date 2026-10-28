// Bargeld-Kasse: Bezüge am Bancomat erfassen, bar bezahlte Ausgaben ziehen sich ab → «Wie viel ist noch im Portemonnaie?»
// Funktioniert auch offline (Einträge warten in der Warteschlange).
import { h, toast, modal, confirmDialog, chips } from '../ui.js';
import { settings, api, render, saveItem, methodName, newId } from '../app.js';
import { cashWallet, cashPlan, isCashMethod, evalExpr, round2, fmt, fmt0, fmtCur, fmtDay, todayStr, rateOf, dayCurrency } from '../calc.js';

const KIND_LABEL = { bezug: 'Bezug', start: 'Anfangsbestand', zurueck: 'Rücktausch', korrektur: 'Korrektur' };

/** «1 CHF = 38.20 THB» bei schwachen Währungen, sonst «1 EUR = 0.95 CHF» */
export function fmtRate(cur, chfPerUnit) {
  if (!(chfPerUnit > 0)) return '';
  return chfPerUnit < 0.2 ? `1 CHF = ${fmt(1 / chfPerUnit)} ${cur}` : `1 ${cur} = ${fmt(chfPerUnit)} CHF`;
}

/** Portemonnaie der gewählten Reise für eine Währung (oder null) */
export function walletFor(t, cur) {
  return cashWallet(settings(), t).find((p) => p.currency === cur) || null;
}

export const cashMethods = () => (settings().methods || []).filter(isCashMethod);

/** Karte «Bargeld» für «Heute» und «Offen → Vor Ort / Bargeld» */
export function walletCard(t) {
  const S = settings();
  const pots = cashWallet(S, t);
  const today = todayStr();
  const need = cashPlan(S, t, { withAllowances: true, from: today > t.start ? today : '', today });
  const noCashMethod = !cashMethods().length;
  return h('section', { class: 'card wallet' },
    h('div', { class: 'card-head' },
      h('h2', null, 'Bargeld'),
      h('div', { class: 'row gap' },
        pots.length ? h('button', { class: 'btn small', onclick: () => countDialog(t) }, 'Kassensturz') : null,
        h('button', { class: 'btn small primary', onclick: () => entryDialog(t) }, '+ Bezug'))
    ),
    noCashMethod ? h('p', { class: 'warn small' }, 'Keine Bezahlmethode ist als Bargeld markiert – unter Mehr → Bezahlmethoden «Bargeld» ankreuzen (z.B. bei «Bar»).') : null,
    pots.length ? pots.map((p) => potBlock(t, p, need.find((g) => g.currency === p.currency))) : h('p', { class: 'muted small' }, 'Bezüge am Bancomat erfassen (Betrag und was die Karte belastet hat). Bar bezahlte Ausgaben ziehen sich automatisch ab – so siehst du jederzeit, wie viel noch im Portemonnaie ist und was dich das Bargeld effektiv gekostet hat.')
  );
}

function potBlock(t, p, needGroup) {
  const S = settings();
  const foreign = p.currency !== 'CHF';
  const rate = p.rate || rateOf(S, p.currency);
  const chf = (v) => (foreign && Number.isFinite(rate) ? h('small', { class: 'muted' }, ' ≈ CHF ' + fmt0(v * rate)) : null);
  const need = needGroup?.total || 0;
  const rest = round2(p.balance - need);
  const history = [
    ...p.entries.map((e) => ({ date: e.date, entry: e })),
    ...p.payments.map((x) => ({ date: x.date, pay: x })),
  ].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return h('div', { class: 'pot' },
    h('div', { class: 'pot-head' },
      h('span', { class: 'cash-cur' }, p.currency),
      h('div', null,
        h('div', { class: 'kl' }, 'Im Portemonnaie'),
        h('div', { class: 'pot-balance' + (p.balance < 0 ? ' neg' : '') }, fmtCur(p.balance, p.currency), chf(p.balance))
      )
    ),
    h('p', { class: 'muted small pot-facts' },
      [`bezogen ${fmt0(p.inflow)}`, `bar ausgegeben ${fmt0(p.spent)}`, p.out ? `zurückgetauscht ${fmt0(p.out)}` : '', p.adjust ? `Korrektur ${p.adjust > 0 ? '+' : ''}${fmt0(p.adjust)}` : ''].filter(Boolean).join(' · '),
      p.rate ? h('span', null, h('br'), `Effektiver Kurs inkl. Gebühren: ${fmtRate(p.currency, p.rate)}`, Number.isFinite(rateOf(S, p.currency)) ? ` (Tageskurs ${fmtRate(p.currency, rateOf(S, p.currency))})` : '') : null
    ),
    need > 0 ? h('p', { class: 'small pot-need ' + (rest < 0 ? 'short' : 'ok') },
      `Vor Ort noch offen bis Reiseende: ~${fmtCur(need, p.currency)} (bar oder Karte, inkl. Pauschalen) → `,
      rest < 0 ? h('strong', null, `noch ~${fmtCur(-rest, p.currency)} beziehen`) : h('strong', null, `reicht, ~${fmtCur(rest, p.currency)} übrig`)
    ) : null,
    history.length ? h('details', { class: 'pot-history' },
      h('summary', null, `Verlauf (${history.length})`),
      h('ul', null, history.map((x) => x.entry
        ? h('li', { class: 'pe-entry' },
            h('span', { class: 'muted' }, x.date ? fmtDay(x.date) : '—'),
            h('span', null, KIND_LABEL[x.entry.kind], x.entry.methodId ? h('span', { class: 'muted' }, ' · ' + methodName(x.entry.methodId)) : null, x.entry.note ? h('span', { class: 'muted' }, ' · ' + x.entry.note) : null),
            h('span', { class: 'num' }, (x.entry.kind === 'zurueck' ? '−' : x.entry.kind === 'korrektur' && x.entry.amount < 0 ? '−' : '+') + fmt0(Math.abs(x.entry.amount)), x.entry.chf ? h('small', { class: 'muted' }, ` CHF ${fmt(x.entry.chf)}`) : null),
            h('button', { class: 'icon-btn sm', 'aria-label': 'Eintrag löschen', onclick: () => deleteEntry(t, x.entry) }, '✕'))
        : h('li', null,
            h('span', { class: 'muted' }, x.date ? fmtDay(x.date) : '—'),
            h('span', null, x.pay.title),
            h('span', { class: 'num' }, '−' + fmt0(x.pay.amount)),
            h('span'))
      ))
    ) : null
  );
}

async function deleteEntry(t, e) {
  if (!(await confirmDialog('Eintrag löschen', `${KIND_LABEL[e.kind]} ${fmtCur(Math.abs(e.amount), e.currency)} löschen?`, 'Löschen', true))) return;
  try {
    await api('DELETE', `/api/trips/${t.id}/cash/${e.id}`);
    t.cash = (t.cash || []).filter((x) => x.id !== e.id);
    render();
  } catch (ex) { toast(ex.message, { error: true }); }
}

async function addEntry(t, entry) {
  const r = await api('POST', `/api/trips/${t.id}/cash`, { ...entry, id: entry.id || newId() });
  (t.cash ||= []).push(r.entry);
  return r.entry;
}

/** Bezug / Anfangsbestand / Rücktausch erfassen */
export async function entryDialog(t) {
  const S = settings();
  const today = todayStr();
  const pots = cashWallet(S, t).map((p) => p.currency);
  const curs = [...new Set([dayCurrency(t, today >= t.start && today <= t.end ? today : t.start), t.currency, ...pots, 'CHF'].filter(Boolean))];
  const cards = S.methods.filter((m) => !isCashMethod(m));
  const d = { kind: 'bezug', date: today, amount: '', currency: curs[0], chf: '', methodId: cards[0]?.id || '', note: '' };
  const err = h('p', { class: 'form-error' });
  const chfHint = h('span', { class: 'muted small' });
  const updHint = () => {
    const v = evalExpr(d.amount);
    const r = rateOf(S, d.currency);
    chfHint.textContent = v && Number.isFinite(r) && d.currency !== 'CHF' ? `Tageskurs: ≈ CHF ${fmt(v * r)}` : '';
  };
  const methodRow = h('label', null, 'Von Karte / Konto', h('select', { onchange: (e) => (d.methodId = e.target.value) },
    h('option', { value: '' }, '—'), cards.map((m) => h('option', { value: m.id, selected: m.id === d.methodId }, m.name))));
  const chfRow = h('label', null, 'Belastet CHF (inkl. Gebühren)', h('input', { inputmode: 'decimal', placeholder: 'laut Beleg / Kartenabrechnung', oninput: (e) => (d.chf = e.target.value) }), chfHint);
  const kindChips = chips([{ value: 'bezug', label: 'Bezug' }, { value: 'start', label: 'Anfangsbestand' }, { value: 'zurueck', label: 'Rücktausch' }], d.kind, (v) => {
    d.kind = v;
    methodRow.hidden = v !== 'bezug';
    chfRow.firstChild.textContent = v === 'zurueck' ? 'Erhalten CHF' : v === 'start' ? 'Wert CHF (optional)' : 'Belastet CHF (inkl. Gebühren)';
  }, 'small');
  const content = h('div', { class: 'form-grid' },
    h('div', { class: 'span2' }, kindChips),
    h('label', null, 'Datum', h('input', { type: 'date', value: d.date, required: true, onchange: (e) => (d.date = e.target.value) })),
    h('label', null, 'Währung', h('select', { onchange: (e) => { d.currency = e.target.value; updHint(); } },
      [...new Set([...curs, ...Object.keys(S.rates || {})])].map((c) => h('option', { value: c, selected: c === d.currency }, c)))),
    h('label', null, 'Betrag', h('input', { class: 'amount-input', inputmode: 'decimal', placeholder: 'z.B. 5000', oninput: (e) => { d.amount = e.target.value; updHint(); } })),
    chfRow,
    methodRow,
    h('label', null, 'Notiz', h('input', { placeholder: 'z.B. Bancomat Flughafen', oninput: (e) => (d.note = e.target.value) })),
    h('p', { class: 'hint span2' }, 'Der CHF-Betrag ergibt den effektiven Kurs inkl. Gebühren. Bar bezahlte Ausgaben werden dann zu diesem Kurs gerechnet.'),
    err
  );
  await modal('Bargeld', content, [
    { label: 'Abbrechen', value: null },
    { label: 'Speichern', primary: true, onClick: async () => {
      const amount = round2(evalExpr(d.amount));
      if (!(amount > 0)) { err.textContent = 'Bitte einen Betrag eingeben.'; return false; }
      const chfV = d.chf.trim() ? round2(evalExpr(d.chf)) : null;
      try {
        await addEntry(t, { kind: d.kind, date: d.date, amount, currency: d.currency, chf: Number.isFinite(chfV) ? chfV : d.currency === 'CHF' ? amount : null, methodId: d.kind === 'bezug' ? d.methodId : '', note: d.note });
        toast('Gespeichert');
        return 'ok';
      } catch (ex) { err.textContent = ex.message; return false; }
    } },
  ]);
  render();
}

/** Kassensturz: gezählten Bestand eingeben → Differenz als Ausgabe erfassen oder nur Bestand korrigieren */
export async function countDialog(t) {
  const S = settings();
  const pots = cashWallet(S, t);
  if (!pots.length) return;
  let cur = pots[0].currency;
  const v = { counted: '' };
  const info = h('p', { class: 'small' });
  const err = h('p', { class: 'form-error' });
  const pot = () => pots.find((p) => p.currency === cur);
  const diff = () => round2(evalExpr(v.counted) - pot().balance);
  const upd = () => {
    const c = evalExpr(v.counted);
    if (!Number.isFinite(c) || v.counted === '') { info.textContent = `Laut Reisli: ${fmtCur(pot().balance, cur)}`; return; }
    const d = diff();
    info.textContent = d === 0 ? 'Stimmt genau ✓' : d < 0 ? `${fmtCur(-d, cur)} fehlen – vermutlich nicht erfasste Ausgaben.` : `${fmtCur(d, cur)} mehr als erwartet.`;
  };
  const content = h('div', { class: 'stack' },
    h('details', { class: 'help' },
      h('summary', null, 'Was ist ein Kassensturz?'),
      h('p', { class: 'small' }, 'Zähl das Bargeld im Portemonnaie und tippe den Betrag ein. Reisli vergleicht mit dem erwarteten Bestand (Bezüge minus bar bezahlte Ausgaben).'),
      h('ul', { class: 'small' },
        h('li', null, h('strong', null, 'Fehlbetrag als Ausgabe: '), 'Das fehlende Geld wurde ausgegeben, aber nicht erfasst (Trinkgeld, Snacks …). Es wird als Ausgabe «Bargeld – nicht erfasst» gebucht und zählt zu den Reisekosten.'),
        h('li', null, h('strong', null, 'Nur Bestand korrigieren: '), 'Der Bestand wird angepasst, ohne Ausgabe – z.B. wenn sich Reisli verrechnet hat, ein Betrag doppelt erfasst wurde oder mehr Geld da ist als erwartet. Zählt nicht zu den Kosten.')
      ),
      h('p', { class: 'small muted' }, 'Tipp: Alle paar Tage zählen – je kleiner die Differenz, desto besser weiss man noch, wofür das Geld war.')
    ),
    pots.length > 1 ? chips(pots.map((p) => ({ value: p.currency, label: p.currency })), cur, (x) => { cur = x; upd(); }, 'small') : null,
    h('label', null, 'Gezählt im Portemonnaie', h('input', { class: 'amount-input', inputmode: 'decimal', placeholder: '0', oninput: (e) => { v.counted = e.target.value; upd(); } })),
    info,
    err
  );
  upd();
  const res = await modal('Kassensturz', content, [
    { label: 'Abbrechen', value: null },
    { label: 'Nur Bestand korrigieren', onClick: () => (Number.isFinite(evalExpr(v.counted)) && v.counted !== '' && diff() !== 0 ? 'fix' : ((err.textContent = 'Kein Unterschied zum erwarteten Bestand.'), false)) },
    cashMethods().length ? { label: 'Fehlbetrag als Ausgabe', primary: true, onClick: () => (Number.isFinite(evalExpr(v.counted)) && v.counted !== '' && diff() < 0 ? 'expense' : ((err.textContent = 'Nur möglich, wenn Geld fehlt.'), false)) } : null,
  ].filter(Boolean));
  if (!res) return;
  const d = diff();
  try {
    if (res === 'expense') {
      const rate = pot().rate || rateOf(S, cur);
      await saveItem({
        date: todayStr() < t.start ? t.start : todayStr() > t.end ? t.end : todayStr(), title: 'Bargeld – nicht erfasst', catId: 'sonstiges', detail: 'Kassensturz', place: '', time: '',
        plan: { amount: -d, currency: cur }, payWhere: 'vorort', reserved: false,
        payments: [{ date: todayStr(), amount: -d, currency: cur, chf: Number.isFinite(rate) ? round2(-d * rate) : null, methodId: cashMethods()[0]?.id || '', paidBy: '', note: 'Kassensturz' }],
        split: null, todos: [], files: [], link: '', note: '',
      });
      toast(`${fmtCur(-d, cur)} als Ausgabe «Bargeld – nicht erfasst» gebucht`);
    } else {
      await addEntry(t, { kind: 'korrektur', date: todayStr(), amount: d, currency: cur, chf: null, methodId: '', note: 'Kassensturz' });
      toast('Bestand korrigiert');
    }
  } catch (ex) { toast(ex.message, { error: true }); }
  render();
}

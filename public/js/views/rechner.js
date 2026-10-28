// Schnellrechner: Lokalwährung ⇄ CHF, auch offline (gespeicherte Kurse). Erreichbar über ⇄ in der Kopfzeile.
import { h, modal, chips } from '../ui.js';
import { state, trip, settings } from '../app.js';
import { evalExpr, round2, fmt, fmt0, rateOf, todayStr, dayCurrency, currencies } from '../calc.js';
import { walletFor, fmtRate } from './kasse.js';

const recall = (k) => { try { return localStorage.getItem('reisli.calc.' + k); } catch { return null; } };
const remember = (k, v) => { try { localStorage.setItem('reisli.calc.' + k, v); } catch { /* egal */ } };

export function openCalculator() {
  const S = settings();
  const t = trip();
  const today = todayStr();
  const dayCur = t ? dayCurrency(t, today >= t.start && today <= t.end ? today : t.start) : null;
  const used = t ? [...new Set((t.items || []).map((it) => it.plan?.currency))] : [];
  const list = [...new Set([dayCur, t?.currency, ...used, ...currencies(S)].filter((c) => c && c !== 'CHF'))];
  if (!list.length) list.push('EUR');
  let cur = list.includes(recall('cur')) ? recall('cur') : list[0];
  let useCash = recall('cash') !== '0';
  let last = 'foreign'; // welches Feld zuletzt getippt wurde

  const foreign = h('input', { class: 'calc-in', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Betrag Fremdwährung', oninput: () => { last = 'foreign'; calc(); } });
  const chf = h('input', { class: 'calc-in', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Betrag CHF', oninput: () => { last = 'chf'; calc(); } });
  const curLabel = h('span', { class: 'calc-cur' });
  const rateInfo = h('p', { class: 'muted small' });
  const table = h('div', { class: 'calc-table' });
  const cashToggle = h('label', { class: 'check small' });

  const rate = () => {
    const w = t && useCash ? walletFor(t, cur) : null;
    return w?.rate || rateOf(S, cur);
  };
  const calc = () => {
    const r = rate();
    curLabel.textContent = cur;
    if (!Number.isFinite(r)) {
      rateInfo.textContent = `Kein Kurs für ${cur} – unter Mehr → Währungen erfassen.`;
      table.replaceChildren();
      return;
    }
    if (last === 'foreign') {
      const v = evalExpr(foreign.value);
      chf.value = foreign.value.trim() && Number.isFinite(v) ? fmt(round2(v * r)).replace(/'/g, '') : '';
    } else {
      const v = evalExpr(chf.value);
      foreign.value = chf.value.trim() && Number.isFinite(v) ? String(round2(v / r)) : '';
    }
    const w = t ? walletFor(t, cur) : null;
    cashToggle.hidden = !w?.rate;
    rateInfo.textContent = (w?.rate && useCash ? 'Bezugskurs inkl. Gebühren: ' : 'Tageskurs: ') + fmtRate(cur, r) + (S.rates?.[cur]?.updatedAt ? ` · Stand ${S.rates[cur].updatedAt.slice(8, 10)}.${S.rates[cur].updatedAt.slice(5, 7)}.` : '');
    // Spickzettel mit runden Beträgen
    const unit = Math.pow(10, Math.max(0, Math.round(Math.log10(1 / r))));
    const steps = [1, 2, 5, 10, 20, 50, 100, 200].map((k) => k * unit);
    table.replaceChildren(...steps.map((a) => h('button', { type: 'button', class: 'calc-row', onclick: () => { foreign.value = String(a); last = 'foreign'; calc(); } },
      h('span', null, fmt0(a) + ' ' + cur), h('span', { class: 'muted' }, 'CHF ' + (a * r < 10 ? fmt(a * r) : fmt0(a * r))))));
  };
  cashToggle.append(h('input', { type: 'checkbox', checked: useCash, onchange: (e) => { useCash = e.target.checked; remember('cash', useCash ? '1' : '0'); calc(); } }), 'mit Bezugskurs (inkl. Gebühren)');

  const curPick = chips(list.slice(0, 6).map((c) => ({ value: c, label: c })), cur, (v) => { cur = v; remember('cur', v); calc(); }, 'small');
  const more = list.length > 6 ? h('select', { class: 'cur-more', onchange: (e) => { if (e.target.value) { cur = e.target.value; remember('cur', cur); calc(); } } },
    h('option', { value: '' }, 'Andere …'), list.slice(6).map((c) => h('option', { value: c }, c))) : null;

  const content = h('div', { class: 'stack calc' },
    h('div', { class: 'row gap wrap' }, curPick, more),
    h('div', { class: 'calc-pair' },
      h('label', null, curLabel, foreign),
      h('span', { class: 'calc-eq', 'aria-hidden': 'true' }, '⇅'),
      h('label', null, h('span', { class: 'calc-cur' }, 'CHF'), chf)
    ),
    rateInfo,
    cashToggle,
    table,
    state.offline ? h('p', { class: 'muted small' }, 'Offline – gerechnet mit dem zuletzt geladenen Kurs.') : null
  );
  calc();
  modal('Umrechnen', content, [{ label: 'Schliessen' }]);
}

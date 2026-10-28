// Gemeinsame Bausteine für «Reise bearbeiten», «Neue Reise» und «Mehr»
import { h, modal } from '../ui.js';
import { state, api, settings, refreshRates } from '../app.js';
import { currencies } from '../calc.js';

export const uid = () => Math.random().toString(36).slice(2, 10);

const WIDE = new Set(['allowances', 'rates']);
export const card = (id, title, ...children) => h('section', { class: 'card' + (WIDE.has(id) ? ' wide' : ''), id: id ? 'sec-' + id : null }, h('h2', null, title), ...children);
export const curSelect = (value, onChange, extra = []) => {
  const list = [...new Set([...currencies(settings()), ...extra, value].filter(Boolean))].sort((a, b) => (a === 'CHF' ? -1 : b === 'CHF' ? 1 : a.localeCompare(b)));
  return h('select', { onchange: (e) => onChange(e.target.value) }, list.map((c) => h('option', { value: c, selected: c === value }, c)));
};

export async function saveSettings(patch) {
  const res = await api('PUT', '/api/settings', patch);
  state.data.settings = res.settings;
}

/** Neue Reisewährung ohne Kurs: nach dem Kurs fragen */
export async function ensureRate(cur) {
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
  if (state.data.autoRates) refreshRates().catch(() => {});
}

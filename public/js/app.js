// Hauptmodul: Daten laden, Anmeldung, Navigation, Synchronisation
import { h, s, toast } from './ui.js';
import { todayStr, rateOf, currencies } from './calc.js';
import { renderPlan } from './views/plan.js';
import { renderErfassen } from './views/erfassen.js';
import { renderOffen } from './views/offen.js';
import { renderAuswertung } from './views/auswertung.js';
import { renderMehr } from './views/mehr.js';

export const state = {
  data: null, // { rev, trips, settings, user, users }
  tripId: null,
  view: 'plan',
  busy: false, // true während ungespeicherte Eingaben laufen
  params: {},
};

// Einfache Strich-Icons (SVG-Pfade, 24×24)
const ICONS = {
  plan: 'M4 5h16M4 12h16M4 19h10M8 3v4M16 3v4',
  erfassen: 'M12 5v14M5 12h14',
  offen: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  auswertung: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  mehr: 'M5 12h.01M12 12h.01M19 12h.01',
};
const VIEWS = [
  { id: 'plan', label: 'Plan', render: renderPlan },
  { id: 'erfassen', label: 'Erfassen', render: renderErfassen },
  { id: 'offen', label: 'Offen', render: renderOffen },
  { id: 'auswertung', label: 'Auswertung', render: renderAuswertung },
  { id: 'mehr', label: 'Mehr', render: renderMehr },
];
const icon = (id) => s('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': id === 'mehr' ? 3.2 : 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, s('path', { d: ICONS[id] }));

// ---------- API ----------
export async function api(method, url, body, opts = {}) {
  const raw = body instanceof Blob;
  const res = await fetch(url, {
    method,
    headers: raw
      ? { 'Content-Type': body.type || 'application/octet-stream', 'X-Reisli': '1', 'X-File-Name': encodeURIComponent(opts.fileName || body.name || 'datei') }
      : { 'Content-Type': 'application/json', 'X-Reisli': '1' },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (res.status === 401 && !url.startsWith('/api/login')) {
    showLogin(false);
    throw new Error('Nicht angemeldet');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error || 'Fehler ' + res.status);
  if (data && typeof data.rev === 'number' && state.data) state.data.rev = data.rev;
  return data;
}

export async function reload() {
  state.data = await api('GET', '/api/data');
  const trips = state.data.trips;
  let saved = null;
  try { saved = localStorage.getItem('reisli.trip'); } catch { /* privat */ }
  if (!trips.some((t) => t.id === state.tripId)) state.tripId = trips.some((t) => t.id === saved) ? saved : defaultTrip()?.id || null;
}

/** Nächste anstehende Reise (oder die laufende), sonst die zuletzt angelegte */
function defaultTrip() {
  const today = todayStr();
  const active = state.data.trips.filter((t) => !t.archived);
  return active.filter((t) => t.end >= today).sort((a, b) => a.start.localeCompare(b.start))[0] || active[active.length - 1] || state.data.trips[0];
}

export const trip = () => state.data.trips.find((t) => t.id === state.tripId) || null;
export const settings = () => state.data.settings;
export const cat = (id) => settings().categories.find((c) => c.id === id) || { id, name: id || 'Sonstiges', color: '#94a3b8' };
export const methodName = (id) => (id === 'vorort' ? 'vor Ort (noch offen)' : settings().methods.find((m) => m.id === id)?.name || (id ? id : '— ohne —'));
export const personName = (id) => trip()?.split?.participants?.find((p) => p.id === id)?.name || '';
export const tripCurrencies = () => {
  const t = trip();
  const list = currencies(settings());
  const first = [t?.currency, 'CHF'].filter(Boolean);
  return [...new Set([...first, ...list])];
};
export const hasRate = (cur) => Number.isFinite(rateOf(settings(), cur));

export function selectTrip(id) {
  state.tripId = id;
  try { localStorage.setItem('reisli.trip', id); } catch { /* privat */ }
  render();
}

export function go(view, params = {}) {
  state.params = params;
  if (location.hash.slice(1) === view) render();
  else location.hash = view;
}

/** Ändert einen Posten serverseitig und übernimmt das Ergebnis lokal */
export async function saveItem(item) {
  const t = trip();
  if (item.id && t.items.some((x) => x.id === item.id)) {
    const r = await api('PUT', `/api/trips/${t.id}/items/${item.id}`, item);
    t.items = t.items.map((x) => (x.id === item.id ? r.item : x));
    return r.item;
  }
  const r = await api('POST', `/api/trips/${t.id}/items`, item);
  t.items.push(...r.created);
  return r.created[0];
}
export async function deleteItem(id) {
  const t = trip();
  await api('DELETE', `/api/trips/${t.id}/items/${id}`);
  t.items = t.items.filter((x) => x.id !== id);
}
export async function saveTripMeta(patch) {
  const t = trip();
  const r = await api('PUT', `/api/trips/${t.id}`, { ...t, ...patch });
  Object.assign(t, r.trip);
  return t;
}
export async function saveDay(date, day) {
  const t = trip();
  const r = await api('PUT', `/api/trips/${t.id}/days/${date}`, day);
  t.days[date] = r.day;
}

/** Datei-Download über einen unsichtbaren Link (Cookies werden mitgeschickt) */
export function download(url) {
  const a = h('a', { href: url, download: '' });
  document.body.append(a);
  a.click();
  a.remove();
}

// ---------- Rendering ----------
const main = () => document.getElementById('main');

export function render() {
  if (!state.data) return;
  renderChrome();
  const v = VIEWS.find((x) => x.id === state.view) || VIEWS[0];
  const el = v.render();
  main().replaceChildren(el);
  const t = trip();
  document.title = `${v.label}${t ? ' · ' + t.name : ''} · Reisli`;
}

function renderChrome() {
  const trips = state.data.trips;
  const header = document.getElementById('topbar');
  const active = trips.filter((t) => !t.archived || t.id === state.tripId).sort((a, b) => a.start.localeCompare(b.start));
  header.replaceChildren(
    h('a', { class: 'brand', href: '#plan' }, h('img', { class: 'logo', src: '/icons/icon.svg', alt: '' }), h('span', null, 'Reisli')),
    h('nav', { class: 'tabs' },
      VIEWS.map((v) => h('a', { href: '#' + v.id, class: 'tab' + (state.view === v.id ? ' on' : '') }, h('span', { class: 'ti' }, icon(v.id)), h('span', null, v.label)))
    ),
    trips.length
      ? h('label', { class: 'trip-select' },
          h('span', { class: 'sr' }, 'Reise'),
          h('select', { onchange: (e) => (e.target.value === '__new' ? go('mehr', { newTrip: true }) : selectTrip(e.target.value)), 'aria-label': 'Reise' },
            active.map((t) => h('option', { value: t.id, selected: t.id === state.tripId }, t.name)),
            h('option', { value: '__new' }, '+ Neue Reise …')
          )
        )
      : h('span')
  );
}

// ---------- Anmeldung ----------
async function showLogin(needsSetup) {
  document.getElementById('topbar').replaceChildren();
  const err = h('p', { class: 'form-error', role: 'alert' });
  const name = h('input', { name: 'name', autocomplete: 'username', required: true, placeholder: 'Vorname' });
  const pw = h('input', { name: 'password', type: 'password', autocomplete: needsSetup ? 'new-password' : 'current-password', required: true, minlength: needsSetup ? 8 : null });
  const form = h('form', {
    class: 'login card',
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      try {
        await api('POST', needsSetup ? '/api/setup' : '/api/login', { name: name.value, password: pw.value });
        await start();
      } catch (ex) {
        err.textContent = ex.message;
      }
    },
  },
    h('div', { class: 'brand big' }, h('img', { class: 'logo', src: '/icons/icon.svg', alt: '' }), h('span', null, 'Reisli')),
    h('h1', null, needsSetup ? 'Erstes Konto anlegen' : 'Anmelden'),
    needsSetup ? h('p', { class: 'muted' }, 'Weitere Personen kannst du danach unter «Mehr» hinzufügen.') : null,
    h('label', null, 'Name', name),
    h('label', null, needsSetup ? 'Passwort (mind. 8 Zeichen)' : 'Passwort', pw),
    err,
    h('button', { class: 'btn primary block', type: 'submit' }, needsSetup ? 'Konto anlegen' : 'Anmelden')
  );
  main().replaceChildren(h('div', { class: 'login-wrap' }, form));
  name.focus();
}

// ---------- Synchronisation zwischen Geräten ----------
let polling;
function startPolling() {
  clearInterval(polling);
  const check = async () => {
    if (document.hidden || !state.data || state.busy || document.querySelector('dialog[open]')) return;
    try {
      const { rev } = await api('GET', '/api/rev');
      if (rev !== state.data.rev) {
        await reload();
        render();
        toast('Daten wurden aktualisiert');
      }
    } catch { /* offline – später nochmals */ }
  };
  polling = setInterval(check, 20000);
  document.addEventListener('visibilitychange', () => !document.hidden && check());
}

async function start() {
  const st = await (await fetch('/api/status', { credentials: 'same-origin' })).json();
  if (!st.user) return showLogin(st.needsSetup);
  await reload();
  state.view = (location.hash || '#plan').slice(1);
  render();
  startPolling();
}

window.addEventListener('hashchange', () => {
  state.view = location.hash.slice(1) || 'plan';
  render();
  window.scrollTo(0, 0);
});

window.addEventListener('beforeunload', (e) => {
  if (state.busy) e.preventDefault();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

start().catch((e) => {
  main().replaceChildren(h('div', { class: 'card' }, h('h2', null, 'Server nicht erreichbar'), h('p', null, e.message)));
});

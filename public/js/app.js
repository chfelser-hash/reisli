// Hauptmodul: Daten laden, Anmeldung, Navigation, Synchronisation
import { h, s, toast, modal } from './ui.js';
import { todayStr, rateOf, currencies, fmtRange, daysBetween, dayNumber } from './calc.js';
import { renderPlan } from './views/plan.js';
import { renderErfassen } from './views/erfassen.js';
import { renderOffen } from './views/offen.js';
import { renderAuswertung } from './views/auswertung.js';
import { renderMehr } from './views/mehr.js';
import { renderReise } from './views/reise.js';
import { newTripDialog } from './views/newtrip.js';
import { renderHeute, syncDialog, tripRunning } from './views/heute.js';
import { renderDokumente } from './views/dokumente.js';
import { openCalculator } from './views/rechner.js';
import { importDialog, takeShared } from './views/importbuchung.js';
import { kvGet, kvSet, kvDel } from './idb.js';

export const state = {
  data: null, // { rev, trips, settings, user, users }
  tripId: null,
  view: 'plan',
  busy: false, // true während ungespeicherte Eingaben laufen
  params: {},
  offline: false, // Server gerade nicht erreichbar
  outbox: [], // offline gemachte Änderungen, die noch zum Server müssen
  conflicts: [], // Änderungen, die der Server nicht übernehmen konnte
  savedAt: null, // Zeitpunkt des letzten vollständigen Datenstands vom Server
};

// Einfache Strich-Icons (SVG-Pfade, 24×24)
const ICONS = {
  heute: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  plan: 'M4 5h16M4 12h16M4 19h10M8 3v4M16 3v4',
  erfassen: 'M12 5v14M5 12h14',
  offen: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  auswertung: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  dokumente: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  mehr: 'M5 12h.01M12 12h.01M19 12h.01',
};
const VIEWS = [
  // «Heute» erscheint nur, wenn eine Reise läuft oder in Kürze beginnt
  // «Heute» gibt es, solange eine Reise läuft oder bevorsteht – und zeigt immer diese nächste Reise
  { id: 'heute', label: 'Heute', render: () => renderHeute(), when: () => !!nextTrip() },
  { id: 'plan', label: 'Plan', render: renderPlan },
  { id: 'erfassen', label: 'Erfassen', short: 'Neu', render: renderErfassen },
  { id: 'offen', label: 'Offen', render: renderOffen },
  { id: 'auswertung', label: 'Auswertung', short: 'Analyse', render: renderAuswertung },
  { id: 'dokumente', label: 'Dokumente', short: 'Papiere', render: () => renderDokumente() },
  { id: 'mehr', label: 'Mehr', render: renderMehr },
  // Ohne eigenen Tab (über ✎ im Plan erreichbar)
  { id: 'reise', label: 'Reise bearbeiten', render: renderReise, hidden: true, tab: 'plan' },
];
const icon = (id) => s('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': id === 'mehr' ? 3.2 : 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, s('path', { d: ICONS[id] }));

// ---------- API (mit Unterwegs-Modus) ----------
// Ist der Server nicht erreichbar, arbeitet die App mit dem zuletzt geladenen Stand weiter (IndexedDB).
// Posten, Zahlungen, To-dos und Rückzahlungen lassen sich dann trotzdem erfassen: die Änderungen landen in einer
// Warteschlange («outbox») und werden beim nächsten Kontakt mit dem Server der Reihe nach nachgesendet.

/** Eindeutige ID, im Browser erzeugt – so kann der Server doppelt gesendete Einträge erkennen */
export const newId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10).padEnd(8, '0');

const netError = (msg) => Object.assign(new Error(msg), { offline: true });

async function rawFetch(method, url, body, opts = {}) {
  const raw = body instanceof Blob;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || (raw ? 180000 : 15000));
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: raw
        ? { 'Content-Type': body.type || 'application/octet-stream', 'X-Reisli': '1', 'X-File-Name': encodeURIComponent(opts.fileName || body.name || 'datei') }
        : { 'Content-Type': 'application/json', 'X-Reisli': '1' },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      credentials: 'same-origin',
      signal: ctrl.signal,
    });
  } catch {
    throw netError('Keine Verbindung zum Reisli-Server');
  } finally {
    clearTimeout(timer);
  }
  // Vorgeschalteter Proxy (z.B. Tailscale) erreicht Reisli nicht
  if (res.status === 502 || res.status === 503 || res.status === 504) throw netError('Reisli-Server antwortet nicht');
  return res;
}

/** Welche Änderungen dürfen offline gemacht werden? */
function offlineOp(method, url) {
  let m = url.match(/^\/api\/trips\/([\w-]+)\/items$/);
  if (m && method === 'POST') return { kind: 'item-new', tripId: m[1] };
  m = url.match(/^\/api\/trips\/([\w-]+)\/items\/([\w-]+)$/);
  if (m && method === 'PUT') return { kind: 'item-put', tripId: m[1], itemId: m[2] };
  if (m && method === 'DELETE') return { kind: 'item-del', tripId: m[1], itemId: m[2] };
  m = url.match(/^\/api\/trips\/([\w-]+)\/repayments$/);
  if (m && method === 'POST') return { kind: 'rep-new', tripId: m[1] };
  m = url.match(/^\/api\/trips\/([\w-]+)\/packing$/);
  if (m && method === 'POST') return { kind: 'pack-new', tripId: m[1] };
  m = url.match(/^\/api\/trips\/([\w-]+)\/packing\/([\w-]+)$/);
  if (m && method === 'PUT') return { kind: 'pack-put', tripId: m[1], packId: m[2] };
  if (m && method === 'DELETE') return { kind: 'pack-del', tripId: m[1], packId: m[2] };
  m = url.match(/^\/api\/trips\/([\w-]+)\/cash$/);
  if (m && method === 'POST') return { kind: 'cash-new', tripId: m[1] };
  m = url.match(/^\/api\/trips\/([\w-]+)\/cash\/([\w-]+)$/);
  if (m && method === 'DELETE') return { kind: 'cash-del', tripId: m[1], cashId: m[2] };
  m = url.match(/^\/api\/trips\/([\w-]+)\/repayments\/([\w-]+)$/);
  if (m && method === 'DELETE') return { kind: 'rep-del', tripId: m[1], repId: m[2] };
  return null;
}

export async function api(method, url, body, opts = {}) {
  const op = method === 'GET' ? null : offlineOp(method, url);
  if (op?.kind === 'pack-new') body = Array.isArray(body) ? body.map((x) => ({ ...x, id: x.id || newId() })) : { ...body, id: body.id || newId() };
  if (op?.kind === 'item-new') body = Array.isArray(body) ? body.map((x) => ({ ...x, id: x.id || newId() })) : { ...body, id: body.id || newId() };
  if (op?.kind === 'rep-new' || op?.kind === 'cash-new') body = { ...body, id: body.id || newId() };
  // Liegt noch etwas in der Warteschlange, hinten anstellen – sonst stimmt die Reihenfolge nicht mehr
  if (op && (state.offline || state.outbox.length)) return enqueue(method, url, body, op);
  let res;
  try {
    res = await rawFetch(method, url, body, opts);
  } catch (e) {
    setOffline(true);
    if (op) return enqueue(method, url, body, op);
    if (method !== 'GET') throw new Error('Offline – das geht nur mit Verbindung zum Reisli-Server. Ausgaben, Zahlungen und To-dos kannst du auch offline erfassen.');
    throw e;
  }
  setOffline(false);
  if (res.status === 401 && !url.startsWith('/api/login')) {
    showLogin(false);
    throw new Error('Nicht angemeldet');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error || 'Fehler ' + res.status);
  if (data && typeof data.rev === 'number' && state.data) state.data.rev = data.rev;
  if (method !== 'GET') scheduleSnapshot();
  return data;
}

// ----- Warteschlange -----
const listOf = (b) => (Array.isArray(b) ? b : [b]);

function enqueue(method, url, body, op) {
  const ob = state.outbox;
  const now = new Date().toISOString();
  const by = state.data?.user?.name || '';
  const t = state.data?.trips.find((x) => x.id === op.tripId);
  const entry = { id: newId(), at: now, method, url, body, ...op };
  let res = {};
  if (op.kind === 'item-new') {
    ob.push(entry);
    res = { created: listOf(body).map((x) => ({ payments: [], todos: [], ...x, files: [], by, createdAt: now })) };
  } else if (op.kind === 'item-put') {
    const cur = t?.items.find((x) => x.id === op.itemId);
    const pendingNew = ob.find((o) => o.kind === 'item-new' && listOf(o.body).some((x) => x.id === op.itemId));
    const pendingPut = ob.find((o) => o.kind === 'item-put' && o.itemId === op.itemId);
    if (pendingNew) {
      // Noch nicht übertragener neuer Posten: einfach den neuen Stand senden
      pendingNew.body = Array.isArray(pendingNew.body) ? pendingNew.body.map((x) => (x.id === op.itemId ? { ...body, id: op.itemId } : x)) : { ...body, id: op.itemId };
    } else if (pendingPut) {
      pendingPut.body = { ...body, baseUpdatedAt: pendingPut.body.baseUpdatedAt };
    } else {
      ob.push({ ...entry, body: { ...body, baseUpdatedAt: cur ? cur.updatedAt || cur.createdAt : undefined } });
    }
    res = { item: { ...cur, ...body, files: cur?.files || [], updatedAt: now } };
  } else if (op.kind === 'item-del') {
    const pendingNew = ob.find((o) => o.kind === 'item-new' && listOf(o.body).some((x) => x.id === op.itemId));
    state.outbox = ob.filter((o) => !(o.kind === 'item-put' && o.itemId === op.itemId));
    if (pendingNew) {
      const rest = listOf(pendingNew.body).filter((x) => x.id !== op.itemId);
      if (rest.length) pendingNew.body = rest;
      else state.outbox = state.outbox.filter((o) => o !== pendingNew);
    } else state.outbox.push(entry);
  } else if (op.kind === 'rep-new') {
    ob.push(entry);
    res = { repayment: { ...body, by, createdAt: now } };
  } else if (op.kind === 'pack-new') {
    ob.push(entry);
    res = { created: listOf(body) };
  } else if (op.kind === 'pack-put') {
    // Neuer, noch nicht gesendeter Eintrag: dort ändern; sonst nur der letzte Stand zählt
    const pendingNew = ob.find((o) => o.kind === 'pack-new' && listOf(o.body).some((x) => x.id === op.packId));
    const pendingPut = ob.find((o) => o.kind === 'pack-put' && o.packId === op.packId);
    if (pendingNew) pendingNew.body = listOf(pendingNew.body).map((x) => (x.id === op.packId ? { ...x, ...body } : x));
    else if (pendingPut) pendingPut.body = { ...pendingPut.body, ...body };
    else ob.push(entry);
    const cur = t?.packing?.find((x) => x.id === op.packId);
    res = { item: { ...cur, ...body } };
  } else if (op.kind === 'pack-del') {
    const pendingNew = ob.find((o) => o.kind === 'pack-new' && listOf(o.body).some((x) => x.id === op.packId));
    state.outbox = ob.filter((o) => !(o.kind === 'pack-put' && o.packId === op.packId));
    if (pendingNew) {
      const rest = listOf(pendingNew.body).filter((x) => x.id !== op.packId);
      if (rest.length) pendingNew.body = rest;
      else state.outbox = state.outbox.filter((o) => o !== pendingNew);
    } else state.outbox.push(entry);
  } else if (op.kind === 'cash-new') {
    ob.push(entry);
    res = { entry: { ...body, by, createdAt: now } };
  } else if (op.kind === 'cash-del') {
    const pendingNew = ob.find((o) => o.kind === 'cash-new' && o.body.id === op.cashId);
    if (pendingNew) state.outbox = ob.filter((o) => o !== pendingNew);
    else ob.push(entry);
  } else if (op.kind === 'rep-del') {
    const pendingNew = ob.find((o) => o.kind === 'rep-new' && o.body.id === op.repId);
    if (pendingNew) state.outbox = ob.filter((o) => o !== pendingNew);
    else ob.push(entry);
  }
  saveQueues();
  scheduleSnapshot();
  updateNetBadge();
  if (!state.offline) setTimeout(() => sync(), 0);
  return Promise.resolve(res);
}

function saveQueues() {
  kvSet('outbox', state.outbox);
  kvSet('conflicts', state.conflicts);
}

/** Lokale Kopie aktualisieren (kurz verzögert, damit die aufrufende Ansicht ihre Änderung schon übernommen hat) */
let snapTimer;
function scheduleSnapshot() {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    if (!state.data) return;
    kvSet('data', state.data);
    kvSet('savedAt', state.savedAt);
  }, 300);
}

function setOffline(v) {
  if (state.offline === v) return;
  state.offline = v;
  updateNetBadge();
  if (!v && state.outbox.length) setTimeout(() => sync(), 0);
}

/** Inhaltlich gleich? (Dann war ein «Konflikt» nur unsere eigene, schon angekommene Änderung) */
function sameItem(a, b) {
  if (!a || !b) return false;
  const pay = (p) => (p || []).map((x) => [x.id, x.date || '', +x.amount || 0, x.currency, x.chf ?? null, x.methodId || '', x.paidBy || '', x.note || '']);
  const pick = (x) => JSON.stringify([x.date, x.endDate || '', x.time || '', x.title, x.detail || '', x.catId, x.place || '', +x.plan?.amount || 0, x.plan?.currency, !!x.reserved, x.payWhere, x.dueDate || '', x.dueMethodId || '', pay(x.payments), !!x.done, x.note || '', (x.todos || []).map((t) => [t.text, !!t.done, t.due || ''])]);
  return pick(a) === pick(b);
}

let syncing = null;
/** Warteschlange nachsenden. Liefert true, wenn danach nichts mehr wartet. */
export function sync() {
  return (syncing ||= doSync().finally(() => (syncing = null)));
}
async function doSync() {
  let sent = 0;
  while (state.outbox.length) {
    const op = state.outbox[0];
    let res;
    try {
      res = await rawFetch(op.method, op.url, op.body);
    } catch {
      setOffline(true);
      break;
    }
    setOffline(false);
    if (res.status === 401) { showLogin(false); break; }
    if (res.status >= 500) break; // später nochmals
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : {};
    if (res.status === 409 && op.kind === 'item-put') {
      if (!sameItem(op.body, data.item)) state.conflicts.push({ id: op.id, at: op.at, tripId: op.tripId, itemId: op.itemId, mine: op.body, theirs: data.item });
    } else if (!res.ok) {
      state.conflicts.push({ id: op.id, at: op.at, tripId: op.tripId, op, error: data?.error || 'Fehler ' + res.status });
    }
    state.outbox.shift();
    sent++;
    saveQueues();
  }
  updateNetBadge();
  if (sent && !state.outbox.length) {
    // Frischen Stand holen – ausser jemand tippt gerade (dann übernimmt das die regelmässige Abfrage)
    if (!state.busy && !document.querySelector('dialog[open]')) {
      try { await reload(false); render(); } catch { /* egal */ }
    }
    toast(state.conflicts.length ? `Offline-Änderungen übertragen – ${state.conflicts.length} Konflikt(e) prüfen` : `${sent} Offline-Änderung${sent === 1 ? '' : 'en'} übertragen`, state.conflicts.length ? { action: { label: 'Prüfen', fn: () => syncDialog() } } : {});
  }
  return !state.outbox.length;
}

export async function reload(withSync = true) {
  if (withSync && state.outbox.length) await sync();
  if (state.outbox.length && state.data) return; // noch offline: lokalen Stand behalten
  try {
    state.data = await api('GET', '/api/data');
    state.savedAt = new Date().toISOString();
    kvSet('data', state.data);
    kvSet('savedAt', state.savedAt);
  } catch (e) {
    if (!e.offline) throw e;
    if (!state.data) {
      const snap = await kvGet('data');
      if (!snap) throw new Error('Keine Verbindung zum Reisli-Server und auf diesem Gerät sind noch keine Offline-Daten gespeichert.');
      state.data = snap;
      state.savedAt = await kvGet('savedAt');
    }
  }
  const trips = state.data.trips;
  let saved = null;
  try { saved = localStorage.getItem('reisli.trip'); } catch { /* privat */ }
  if (!trips.some((t) => t.id === state.tripId)) state.tripId = trips.some((t) => t.id === saved) ? saved : defaultTrip()?.id || null;
}

/** Alles Lokale löschen (beim Abmelden) */
export async function clearLocal() {
  await Promise.all(['data', 'savedAt', 'outbox', 'conflicts'].map(kvDel));
}

/** Nächste anstehende Reise (oder die laufende), sonst die zuletzt angelegte */
/** Laufende oder nächste bevorstehende Reise (nicht archiviert) */
export function nextTrip() {
  const today = todayStr();
  return state.data.trips.filter((t) => !t.archived && t.end >= today).sort((a, b) => a.start.localeCompare(b.start))[0] || null;
}
function selectTripSilently(id) {
  state.tripId = id;
  try { localStorage.setItem('reisli.trip', id); } catch { /* privat */ }
}

function defaultTrip() {
  const today = todayStr();
  const active = state.data.trips.filter((t) => !t.archived);
  return active.filter((t) => t.end >= today).sort((a, b) => a.start.localeCompare(b.start))[0] || active[active.length - 1] || state.data.trips[0];
}

export const trip = () => state.data.trips.find((t) => t.id === state.tripId) || null;
export const settings = () => state.data.settings;
export const cat = (id) => settings().categories.find((c) => c.id === id) || { id, name: id || 'Sonstiges', color: '#94a3b8' };
export const methodName = (id) => (id === 'vorort' ? 'vor Ort' : settings().methods.find((m) => m.id === id)?.name || (id ? '⚠ gelöschte Methode' : '— noch nicht festgelegt —'));
/** Methode existiert nicht mehr in den Einstellungen */
export const isOrphanMethod = (id) => !!id && id !== 'vorort' && !settings().methods.some((m) => m.id === id);

/** Dialog: Methode «from» überall durch eine andere ersetzen. Liefert true, wenn ersetzt. */
export async function replaceMethodDialog(from, text, methods = settings().methods) {
  const sel = h('select', null, h('option', { value: '' }, '— ohne Methode —'), methods.filter((m) => m.id !== from).map((m) => h('option', { value: m.id }, m.name)));
  const r = await modal('Bezahlmethode ersetzen', h('div', { class: 'stack' }, h('p', null, text), h('label', null, 'Ersetzen durch', sel)),
    [{ label: 'Abbrechen', value: null }, { label: 'Ersetzen', primary: true, value: 'ok' }]);
  if (r !== 'ok') return false;
  const res = await api('POST', '/api/methods/replace', { from, to: sel.value });
  await reload();
  toast(`${res.count} Einträge umgehängt`);
  return true;
}
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

/**
 * Wechselkurse aktualisieren: zuerst über den Server; klappt das nicht (z.B. Firmen-Proxy), holt der Browser
 * die Kurse selbst beim Kursdienst und schickt sie dem Server. Liefert {date, updated, missing, via}.
 */
export async function refreshRates() {
  let serverError;
  try {
    const r = await api('POST', '/api/rates/refresh');
    state.data.settings = r.settings;
    return { ...r, via: 'server' };
  } catch (e) {
    serverError = e;
  }
  try {
    const res = await fetch(state.data.rateUrl || 'https://api.frankfurter.dev/v1/latest?from=CHF', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('Kursdienst antwortet mit ' + res.status);
    const j = await res.json();
    const r = await api('POST', '/api/rates/apply', { date: j.date, rates: j.rates });
    state.data.settings = r.settings;
    return r;
  } catch (e) {
    throw new Error(`${serverError.message}. Auch der Browser kam nicht durch (${e.message}). Kurse bitte manuell erfassen.`);
  }
}

/** Beim Öffnen: Kurse höchstens einmal pro Tag automatisch holen (still, ohne Meldung bei Fehlern) */
async function autoRefreshRates() {
  const S = state.data?.settings;
  if (!state.data?.autoRates || !S || !Object.values(S.rates || {}).some((r) => !r.locked)) return;
  const last = Date.parse(S.ratesFetchedAt || 0) || 0;
  if (Date.now() - last < 20 * 3600e3) return;
  try {
    const r = await refreshRates();
    if (r.updated?.length && !state.busy && !document.querySelector('dialog[open]')) render();
  } catch { /* offline – dann eben morgen */ }
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
  const v = VIEWS.find((x) => x.id === state.view) || VIEWS[0];
  if (v.id === 'heute') {
    const n = nextTrip();
    if (n && n.id !== state.tripId) selectTripSilently(n.id);
  }
  renderChrome(v.tab || v.id);
  const el = v.render();
  main().replaceChildren(el);
  const t = trip();
  document.title = `${v.label}${t ? ' · ' + t.name : ''} · Reisli`;
  updateNetBadge();
}

function renderChrome(activeTab) {
  const header = document.getElementById('topbar');
  header.replaceChildren(
    h('a', { class: 'brand', href: '#plan', title: state.data.version ? `Reisli ${state.data.version}` : 'Reisli' }, h('img', { class: 'logo', src: '/icons/icon.svg', alt: '' }), h('span', null, 'Reisli')),
    h('nav', { class: 'tabs' },
      VIEWS.filter((v) => !v.hidden && (!v.when || v.when() || activeTab === v.id)).map((v) => h('a', { href: '#' + v.id, class: 'tab' + (activeTab === v.id ? ' on' : '') }, h('span', { class: 'ti' }, icon(v.id)), h('span', { class: 'tl' }, v.label), h('span', { class: 'tl-short' }, v.short || v.label)))
    ),
    netBadge(),
    h('button', { type: 'button', class: 'icon-btn calc-btn', title: 'Umrechnen', 'aria-label': 'Umrechnen', onclick: () => openCalculator() }, '⇄'),
    tripPicker()
  );
}

/** Anzeige oben: offline / Änderungen warten / Konflikte – Klick öffnet die Übersicht */
function netBadge() {
  return h('button', { type: 'button', id: 'net-badge', class: 'net-badge', hidden: true, onclick: () => syncDialog() });
}
export function updateNetBadge() {
  const el = document.getElementById('net-badge');
  if (!el) return;
  const n = state.outbox.length;
  const c = state.conflicts.length;
  const parts = [];
  if (state.offline) parts.push('Offline');
  if (n) parts.push(`${n} wartend`);
  if (c) parts.push(`⚠ ${c} Konflikt${c === 1 ? '' : 'e'}`);
  el.hidden = !parts.length;
  el.textContent = parts.join(' · ');
  el.className = 'net-badge' + (c ? ' warn' : state.offline ? ' off' : ' pending');
  el.title = state.offline ? 'Keine Verbindung zum Reisli-Server – du arbeitest mit dem gespeicherten Stand' : '';
}

// ---------- Reise-Auswahl (eigenes Menü mit Zeitspanne) ----------
function tripStatus(t, today) {
  if (today < t.start) {
    const k = daysBetween(today, t.start);
    return k === 1 ? 'morgen' : `in ${k} Tagen`;
  }
  if (today <= t.end) return `läuft · Tag ${dayNumber(t, today)}`;
  return '';
}

function tripPicker() {
  const trips = state.data.trips;
  const today = todayStr();
  const cur = trip();
  const menu = h('div', { class: 'trip-menu', role: 'menu', hidden: true });
  const toggle = (open = menu.hidden) => {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  };
  const entry = (t) => h('button', { type: 'button', role: 'menuitem', class: 'tm-item' + (t.id === state.tripId ? ' on' : ''), onclick: () => {
    toggle(false);
    // «Heute» zeigt immer die nächste Reise – eine andere Reise öffnet darum den Plan
    if (state.view === 'reise' || (state.view === 'heute' && t.id !== nextTrip()?.id)) { selectTripSilently(t.id); go('plan'); } else selectTrip(t.id);
  } },
    h('span', { class: 'tm-name' }, t.name),
    h('span', { class: 'tm-meta' }, fmtRange(t.start, t.end), tripStatus(t, today) ? h('span', { class: 'tm-status' }, tripStatus(t, today)) : null)
  );
  const group = (label, list) => (list.length ? [h('div', { class: 'tm-group' }, label), ...list.map(entry)] : []);
  const active = trips.filter((t) => !t.archived);
  menu.append(
    ...group('Laufend & kommend', active.filter((t) => t.end >= today).sort((a, b) => a.start.localeCompare(b.start))),
    ...group('Vergangen', active.filter((t) => t.end < today).sort((a, b) => b.start.localeCompare(a.start))),
    ...group('Archiv', trips.filter((t) => t.archived).sort((a, b) => b.start.localeCompare(a.start))),
    h('button', { type: 'button', role: 'menuitem', class: 'tm-new', onclick: () => { toggle(false); newTripDialog('leer'); } }, '+ Neue Reise …')
  );
  const btn = h('button', { type: 'button', class: 'trip-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: (e) => { e.stopPropagation(); toggle(); } },
    cur
      ? h('span', { class: 'tb-text' }, h('span', { class: 'tb-name' }, cur.name), h('span', { class: 'tb-range' }, fmtRange(cur.start, cur.end)))
      : h('span', { class: 'tb-text' }, h('span', { class: 'tb-name' }, trips.length ? 'Reise wählen' : 'Neue Reise')),
    h('span', { class: 'tb-caret', 'aria-hidden': 'true' }, '▾')
  );
  return h('div', { class: 'trip-picker' }, btn, menu);
}

// Menü schliessen bei Klick daneben oder Escape
document.addEventListener('click', (e) => {
  if (!e.target.closest('.trip-picker')) document.querySelectorAll('.trip-menu').forEach((m) => (m.hidden = true));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.trip-menu').forEach((m) => (m.hidden = true));
});

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
    if (state.outbox.length) { await sync(); if (state.outbox.length) return; }
    try {
      const { rev, version } = await api('GET', '/api/rev');
      // Auf der NAS wurde eine neue Version eingespielt → einmal Bescheid geben
      if (version && state.loadedVersion && version !== state.loadedVersion && !state.versionNotified) {
        state.versionNotified = true;
        toast(`Neue Reisli-Version ${version} verfügbar`, { duration: 60000, action: { label: 'Neu laden', fn: () => location.reload() } });
      }
      if (rev !== state.data.rev) {
        await reload();
        render();
        toast('Daten wurden aktualisiert');
      }
    } catch { /* offline – später nochmals */ }
  };
  polling = setInterval(check, 20000);
  document.addEventListener('visibilitychange', () => !document.hidden && check());
  window.addEventListener('online', check);
}

/** Startansicht: während einer Reise «Heute», sonst der Plan */
function defaultView() {
  const t = trip();
  return t && tripRunning(t) ? 'heute' : 'plan';
}

async function start() {
  [state.outbox, state.conflicts] = await Promise.all([kvGet('outbox'), kvGet('conflicts')]).then((r) => r.map((x) => x || []));
  let st = null;
  try {
    st = await (await rawFetch('GET', '/api/status', undefined, { timeout: 8000 })).json();
    setOffline(false);
  } catch {
    setOffline(true);
  }
  if (st && !st.user) return showLogin(st.needsSetup);
  // Anderes Konto als beim letzten Mal: alte lokale Kopie nicht weiterverwenden
  if (st) {
    const snap = await kvGet('data');
    if (snap?.user && snap.user.name !== st.user.name) { await clearLocal(); state.outbox = []; state.conflicts = []; }
  }
  await reload();
  state.loadedVersion = state.data.version;
  state.view = location.hash.slice(1) || defaultView();
  if (state.view === 'import') openImport();
  else render();
  startPolling();
  if (!state.offline) autoRefreshRates();
}

window.addEventListener('hashchange', () => {
  state.view = location.hash.slice(1) || 'plan';
  if (state.view === 'import') return openImport();
  render();
  window.scrollTo(0, 0);
});

/** #import (Verknüpfung oder «Teilen → Reisli»): Plan zeigen und den Import-Dialog öffnen */
async function openImport() {
  state.view = 'plan';
  history.replaceState(null, '', '#plan');
  render();
  const shared = await takeShared();
  importDialog(shared && (shared.text || shared.files.length) ? shared : null);
}

window.addEventListener('beforeunload', (e) => {
  if (state.busy) e.preventDefault();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

start().catch((e) => {
  main().replaceChildren(h('div', { class: 'card' }, h('h2', null, 'Server nicht erreichbar'), h('p', null, e.message)));
});

// Hilfsfunktionen für die End-to-End-Tests: Server mit leerem Datenordner starten, API-Zugriff, Testdaten.
// Es werden ausschliesslich erfundene Beispieldaten verwendet.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const day = (k) => {
  const d = new Date();
  d.setDate(d.getDate() + k);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Startet Reisli auf einem freien Port mit leerem Datenordner – im selben Prozess, damit die
 * Testabdeckung (node --experimental-test-coverage) auch den Server-Code erfasst.
 * Pro Testdatei genau einmal aufrufen (node --test startet jede Datei in einem eigenen Prozess).
 */
export async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reisli-e2e-'));
  const port = 18000 + Math.floor(Math.random() * 20000);
  Object.assign(process.env, { PORT: String(port), DATA_DIR: dataDir, AUTO_RATES: 'false', HOST: '127.0.0.1' });
  const log = [];
  const orig = console.log;
  console.log = (...a) => log.push(a.join(' ')); // Server-Meldungen nicht in die Testausgabe
  const mod = await import(path.join(ROOT, 'server/index.js'));
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + '/api/status')).ok) break;
    } catch { /* noch nicht bereit */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  return {
    base,
    dataDir,
    log: () => log.join('\n'),
    readData: () => JSON.parse(fs.readFileSync(path.join(dataDir, 'reisli.json'), 'utf8')),
    async stop() {
      mod.server.closeAllConnections?.();
      await new Promise((r) => mod.server.close(() => r()));
      console.log = orig;
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Kleiner API-Client mit Session-Cookie */
export function apiClient(base) {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const raw = body instanceof Uint8Array;
    const res = await fetch(base + url, {
      method,
      headers: { 'X-Reisli': '1', ...(raw ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
  return call;
}

/** Benutzer, Kurse und eine laufende Testreise anlegen */
export async function seed(api) {
  await api('POST', '/api/setup', { name: 'Anna', password: 'geheim123' });
  await api('POST', '/api/users', { name: 'Ben', password: 'geheim123' });
  const { data: d } = await api('GET', '/api/data');
  await api('PUT', '/api/settings', { rates: { ...d.settings.rates, THB: { rate: 0.025, source: 'manuell' } } });
  const { data: t } = await api('POST', '/api/trips', { name: 'Testreise', start: day(-3), end: day(7), currency: 'THB', travelers: 2 });
  const trip = t.trip;
  const { data: items } = await api('POST', `/api/trips/${trip.id}/items`, [
    { date: day(-1), endDate: day(2), title: 'Hotel am Fluss', catId: 'unterkunft', place: 'Bangkok', plan: { amount: 9000, currency: 'THB' }, payWhere: 'vorort', address: 'Musterstrasse 1', phone: '+66 2 000 0000', bookingRef: 'BK-1' },
    { date: day(0), time: '09:30', title: 'Tempeltour', catId: 'aktivitaet', plan: { amount: 1500, currency: 'THB' }, payWhere: 'vorort' },
    { date: day(0), time: '19:00', title: 'Abendessen', catId: 'essen', plan: { amount: 2400, currency: 'THB' }, payWhere: 'vorort' },
  ]);
  const ticket = items.created[1];
  await api('POST', `/api/trips/${trip.id}/items/${ticket.id}/files`, new TextEncoder().encode('%PDF-1.4 Testticket'), { 'Content-Type': 'application/pdf', 'X-File-Name': 'ticket.pdf' });
  return { trip, items: items.created };
}

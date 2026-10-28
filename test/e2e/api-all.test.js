// Jeder API-Endpunkt mindestens einmal – mit Erfolgs- und Fehlerfällen. Server läuft im Testprozess
// (für die Testabdeckung), Datenordner ist leer, alle Daten sind erfunden.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, apiClient, seed, day } from './helpers.js';

let srv, api, trip, items;
const FIXTURE = new URL('../fixtures/Beispielreise2030.xlsx', import.meta.url);
const data = async () => (await api('GET', '/api/data')).data;
const tripNow = async (id = trip.id) => (await data()).trips.find((t) => t.id === id);

before(async () => {
  srv = await startServer();
  api = apiClient(srv.base);
  ({ trip, items } = await seed(api));
});
after(async () => srv?.stop());

test('Anmeldung: Einrichten nur einmal, falsches Passwort, Abmelden', async () => {
  assert.equal((await api('POST', '/api/setup', { name: 'X', password: 'geheim123' })).status, 403);
  const other = apiClient(srv.base);
  assert.equal((await other('POST', '/api/login', { name: 'Anna', password: 'falsch' })).status, 401);
  assert.equal((await other('POST', '/api/login', { name: 'anna', password: 'geheim123' })).status, 200);
  assert.equal((await other('GET', '/api/data')).status, 200);
  assert.equal((await other('POST', '/api/logout')).status, 200);
  assert.equal((await other('GET', '/api/data')).status, 401);
  const st = (await other('GET', '/api/status')).data;
  assert.equal(st.user, null);
  assert.equal(st.needsSetup, false);
});

test('Benutzer: anlegen, Passwort ändern, löschen (nicht sich selbst)', async () => {
  const u = (await api('POST', '/api/users', { name: 'Carla', password: 'geheim123' })).data;
  assert.equal((await api('POST', '/api/users', { name: 'carla', password: 'geheim123' })).status, 400);
  const me = (await data()).user;
  assert.equal((await api('DELETE', '/api/users/' + me.id)).status, 400);
  assert.equal((await api('DELETE', '/api/users/' + u.id)).status, 200);
  assert.equal((await api('POST', '/api/password', { oldPassword: 'falsch', newPassword: 'neuesPasswort' })).status, 400);
  assert.equal((await api('POST', '/api/password', { oldPassword: 'geheim123', newPassword: 'kurz' })).status, 400);
  assert.equal((await api('POST', '/api/password', { oldPassword: 'geheim123', newPassword: 'geheim123' })).status, 200);
});

test('Reise: ändern, ungültige Daten abgelehnt, unbekannte Reise → 404', async () => {
  const r = await api('PUT', '/api/trips/' + trip.id, { name: 'Testreise neu', note: 'Notiz' });
  assert.equal(r.data.trip.name, 'Testreise neu');
  assert.equal(r.data.trip.items.length, items.length); // Posten bleiben erhalten
  assert.equal((await api('PUT', '/api/trips/' + trip.id, { end: '2000-01-01' })).status, 400);
  assert.equal((await api('PUT', '/api/trips/gibtsnicht', { name: 'x' })).status, 404);
  assert.equal((await api('POST', '/api/trips', { name: '', start: day(1), end: day(2) })).status, 400);
});

test('Reise kopieren: Daten verschoben, ohne Zahlungen und Belege', async () => {
  assert.equal((await api('POST', `/api/trips/${trip.id}/copy`, { start: 'bald' })).status, 400);
  const { data: d } = await api('POST', `/api/trips/${trip.id}/copy`, { name: 'Kopie', start: day(100) });
  assert.equal(d.trip.name, 'Kopie');
  assert.equal(d.trip.start, day(100));
  assert.equal(d.trip.items.length, items.length);
  assert.ok(d.trip.items.every((it) => !it.payments.length && !it.files.length));
  const empty = (await api('POST', `/api/trips/${trip.id}/copy`, { name: 'Leer', start: day(200), keepItems: false })).data.trip;
  assert.equal(empty.items.length, 0);
  await api('DELETE', '/api/trips/' + d.trip.id);
  await api('DELETE', '/api/trips/' + empty.id);
});

test('Tage: Programm speichern, Währung vor Ort für einen Bereich', async () => {
  const r = await api('PUT', `/api/trips/${trip.id}/days/${day(0)}`, { title: 'Tempel', place: 'Bangkok', note: '', skip: [] });
  assert.equal(r.data.day.place, 'Bangkok');
  assert.equal((await api('POST', `/api/trips/${trip.id}/days-currency`, { from: day(2), to: day(1), currency: 'CHF' })).status, 400);
  const c = await api('POST', `/api/trips/${trip.id}/days-currency`, { from: day(5), to: day(7), currency: 'CHF' });
  assert.equal(c.data.days[day(6)].currency, 'CHF');
  assert.equal(c.data.days[day(0)].place, 'Bangkok'); // anderes bleibt
});

test('Kostenaufteilung: Zahler nachträglich zuordnen, Rückzahlungen', async () => {
  const parts = [{ id: 'pa', name: 'Anna' }, { id: 'pb', name: 'Ben' }];
  await api('PUT', '/api/trips/' + trip.id, { split: { enabled: true, participants: parts } });
  const t = await tripNow();
  const it = t.items.find((x) => x.title === 'Tempeltour');
  await api('PUT', `/api/trips/${trip.id}/items/${it.id}`, { ...it, payments: [{ date: day(0), amount: 1500, currency: 'THB', chf: 37.5, methodId: 'bar' }] });
  assert.equal((await api('POST', `/api/trips/${trip.id}/assign-payer`, { paidBy: 'niemand' })).status, 400);
  const a = await api('POST', `/api/trips/${trip.id}/assign-payer`, { paidBy: 'pa' });
  assert.equal(a.data.count, 1);
  assert.equal((await api('POST', `/api/trips/${trip.id}/repayments`, { from: 'pb', to: 'zz', amount: 5 })).status, 400);
  const rep = { id: 'crep00000001', from: 'pb', to: 'pa', amount: 18.75, date: day(0) };
  await api('POST', `/api/trips/${trip.id}/repayments`, rep);
  await api('POST', `/api/trips/${trip.id}/repayments`, rep); // doppelt gesendet
  assert.equal((await tripNow()).repayments.length, 1);
  await api('DELETE', `/api/trips/${trip.id}/repayments/${rep.id}`);
  assert.equal((await tripNow()).repayments.length, 0);
});

test('Posten zusammenführen: Zahlungen und Belege wandern mit', async () => {
  const { data: d } = await api('POST', `/api/trips/${trip.id}/items`, [
    { date: day(1), title: 'Ausflug', plan: { amount: 1000, currency: 'THB' }, payments: [{ date: day(-10), amount: 300, currency: 'THB', chf: 8 }] },
    { date: day(1), title: 'Ausflug Rest', plan: { amount: 0, currency: 'THB' }, payments: [{ date: day(1), amount: 700, currency: 'THB', chf: 18 }] },
  ]);
  const [a, b] = d.created;
  const up = await api('POST', `/api/trips/${trip.id}/items/${b.id}/files`, new TextEncoder().encode('Quittung'), { 'Content-Type': 'text/plain', 'X-File-Name': 'q.txt' });
  assert.equal((await api('POST', `/api/trips/${trip.id}/items/${a.id}/merge`, { otherId: a.id })).status, 400);
  const m = await api('POST', `/api/trips/${trip.id}/items/${a.id}/merge`, { otherId: b.id });
  assert.equal(m.data.item.payments.length, 2);
  assert.equal(m.data.item.files[0].id, up.data.file.id);
  assert.ok(!(await tripNow()).items.some((x) => x.id === b.id));
  // Beleg löschen, leere Datei abgelehnt
  await api('DELETE', `/api/trips/${trip.id}/items/${a.id}/files/${up.data.file.id}`);
  assert.equal((await tripNow()).items.find((x) => x.id === a.id).files.length, 0);
  assert.equal((await api('POST', `/api/trips/${trip.id}/items/${a.id}/files`, new Uint8Array(0))).status, 400);
  assert.equal((await api('GET', '/api/files/gibtsnicht')).status, 404);
});

test('Belege: Download-Kopfzeilen (inline für PDF/Bilder, sonst Anhang)', async () => {
  const t = await tripNow();
  const f = t.items.flatMap((x) => x.files)[0];
  const r1 = await fetch(`${srv.base}/api/files/${f.id}`, { headers: { Cookie: await cookieOf() } });
  assert.match(r1.headers.get('content-disposition'), /^inline/);
  const r2 = await fetch(`${srv.base}/api/files/${f.id}?download=1`, { headers: { Cookie: await cookieOf() } });
  assert.match(r2.headers.get('content-disposition'), /^attachment/);
});
async function cookieOf() {
  const r = await fetch(srv.base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reisli': '1' }, body: JSON.stringify({ name: 'Anna', password: 'geheim123' }) });
  return r.headers.get('set-cookie').split(';')[0];
}

test('Dokumente: ändern, Datei löschen, Dokument löschen, unbekannt → 404', async () => {
  const doc = (await api('POST', '/api/documents', { title: 'Krankenkasse', kind: 'krankenkasse', person: 'Anna' })).data.document;
  const up = (await api('POST', `/api/documents/${doc.id}/files`, new TextEncoder().encode('Karte'), { 'Content-Type': 'image/png', 'X-File-Name': 'karte.png' })).data.file;
  const put = await api('PUT', '/api/documents/' + doc.id, { ...doc, number: '756.0000', files: [] });
  assert.equal(put.data.document.number, '756.0000');
  assert.equal(put.data.document.files.length, 1); // Dateien ändern sich nur über die Datei-API
  await api('DELETE', `/api/documents/${doc.id}/files/${up.id}`);
  assert.equal((await data()).documents.find((d) => d.id === doc.id).files.length, 0);
  await api('DELETE', '/api/documents/' + doc.id);
  assert.equal((await api('PUT', '/api/documents/' + doc.id, { title: 'x' })).status, 404);
  assert.equal((await api('POST', '/api/documents/gibtsnicht/files', new TextEncoder().encode('x'))).status, 404);
});

test('Einstellungen und Bezahlmethode überall ersetzen', async () => {
  const s = (await data()).settings;
  const r = await api('PUT', '/api/settings', { methods: [...s.methods, { id: 'twint', name: 'Twint' }] });
  assert.ok(r.data.settings.methods.some((m) => m.id === 'twint'));
  assert.equal((await api('POST', '/api/methods/replace', { to: 'x' })).status, 400);
  const rep = await api('POST', '/api/methods/replace', { from: 'bar', to: 'twint' });
  assert.ok(rep.data.count >= 1);
  assert.ok(!(await tripNow()).items.some((it) => it.payments.some((p) => p.methodId === 'bar')));
});

test('Kurse: vom Browser übernehmen, vom Server holen (Kursdienst simuliert)', async () => {
  assert.equal((await api('POST', '/api/rates/apply', { date: day(0), rates: {} })).status, 400);
  const a = await api('POST', '/api/rates/apply', { date: day(0), rates: { THB: 40, EUR: 1.05 } });
  assert.equal(a.data.via, 'browser');
  assert.ok(a.data.updated.includes('THB'));
  const orig = globalThis.fetch;
  try {
    // Nur Anfragen an den Kursdienst umleiten, die API-Aufrufe der Tests laufen normal
    globalThis.fetch = (url, opts) => (String(url).includes('frankfurter')
      ? Promise.resolve({ ok: true, json: async () => ({ date: day(0), rates: { THB: 50, EUR: 1 } }) })
      : orig(url, opts));
    const ok = await api('POST', '/api/rates/refresh');
    assert.equal(ok.status, 200);
    assert.equal(ok.data.settings.rates.THB.rate, 0.02);
    globalThis.fetch = (url, opts) => (String(url).includes('frankfurter') ? Promise.reject(Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } })) : orig(url, opts));
    const fail = await api('POST', '/api/rates/refresh');
    assert.equal(fail.status, 502);
    assert.match(fail.data.error, /Adresse nicht gefunden/);
  } finally {
    globalThis.fetch = orig;
  }
});

test('Excel-Import: Vorschau, übernehmen, ungültige Datei', async () => {
  const bad = await api('POST', '/api/import/excel', new TextEncoder().encode('kein excel'), { 'X-File-Name': 'x.xlsx' });
  assert.equal(bad.status, 400);
  const prev = await api('POST', '/api/import/excel', new Uint8Array(fs.readFileSync(FIXTURE)), { 'X-File-Name': 'Beispielreise2030.xlsx' });
  assert.equal(prev.status, 200);
  assert.equal(prev.data.trip.name, 'Beispielreise 2030');
  const before = (await data()).trips.length;
  const c = await api('POST', '/api/import/commit', { trip: { ...prev.data.trip, name: 'Portugal' }, settingsPatch: prev.data.settingsPatch });
  assert.equal(c.data.trip.name, 'Portugal');
  assert.deepEqual(c.data.added.methods, ['Testkarte']);
  assert.equal((await data()).trips.length, before + 1);
});

test('Export: Reise als JSON und CSV, als Sicherung wieder einspielbar', async () => {
  const csv = await api('GET', `/api/trips/${trip.id}/export.csv`);
  assert.match(csv.data, /Tempeltour/);
  const json = (await api('GET', `/api/trips/${trip.id}/export.json`)).data;
  assert.equal(json.kind, 'trip');
  const r = await api('POST', '/api/restore', json);
  assert.equal(r.data.mode, 'trip');
  assert.notEqual(r.data.trip.id, trip.id); // als neue Reise
  assert.ok(r.data.trip.items.every((it) => !it.files.length));
  await api('DELETE', '/api/trips/' + r.data.trip.id);
});

test('Sicherung: herunterladen, einspielen (inkl. Belege), Server-Sicherungen', async () => {
  const full = (await api('GET', '/api/backup?files=1')).data;
  assert.equal(full.app, 'reisli');
  assert.ok(Object.keys(full.files).length >= 1);
  assert.equal((await api('POST', '/api/restore', { trips: 'kaputt' })).status, 400);
  // Server-Sicherung anlegen, dann etwas ändern und zurückholen
  const { data: b } = await api('POST', '/api/backups');
  assert.ok(b.backups.some((x) => x.name === b.name));
  await api('POST', '/api/trips', { name: 'Nach der Sicherung', start: day(300), end: day(301) });
  const dl = await api('GET', '/api/backups/' + b.name);
  assert.ok(Array.isArray(dl.data.trips));
  assert.equal((await api('GET', '/api/backups/gibtsnicht.json')).status, 404);
  assert.equal((await api('POST', '/api/backups/gibtsnicht.json/restore')).status, 404);
  await api('POST', `/api/backups/${b.name}/restore`);
  assert.ok(!(await data()).trips.some((t) => t.name === 'Nach der Sicherung'));
  // komplette Sicherung mit Belegen einspielen
  const r = await api('POST', '/api/restore', full);
  assert.equal(r.data.mode, 'all');
  assert.equal(r.data.files, Object.keys(full.files).length);
  const list = (await api('GET', '/api/backups')).data;
  assert.ok(list.files.count >= 1);
});

test('Belege aufräumen: löscht nur alte Dateien ohne Verweis', async () => {
  const { cleanupFiles } = await import('../../server/index.js');
  const dir = path.join(srv.dataDir, 'files');
  const old = Date.now() / 1000 - 5 * 86400;
  fs.writeFileSync(path.join(dir, 'verwaist1'), 'x');
  fs.utimesSync(path.join(dir, 'verwaist1'), old, old);
  fs.writeFileSync(path.join(dir, 'frisch1'), 'x'); // jünger als 2 Tage → bleibt
  const used = (await data()).trips.flatMap((t) => t.items.flatMap((it) => it.files.map((f) => f.id)));
  for (const id of used) fs.utimesSync(path.join(dir, id), old, old);
  const r = cleanupFiles();
  assert.equal(r.removed, 1);
  assert.ok(!fs.existsSync(path.join(dir, 'verwaist1')));
  assert.ok(fs.existsSync(path.join(dir, 'frisch1')));
  for (const id of used) assert.ok(fs.existsSync(path.join(dir, id)), 'verwendeter Beleg darf nicht gelöscht werden');
});

test('Statische Dateien, Sicherheits-Kopfzeilen, unbekannte Aufrufe', async () => {
  const idx = await fetch(srv.base + '/plan'); // App-Routen liefern index.html
  assert.equal(idx.status, 200);
  assert.match(idx.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(idx.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal((await fetch(srv.base + '/gibtsnicht.js')).status, 404);
  assert.equal((await fetch(srv.base + '/..%2fpackage.json')).status, 403);
  assert.equal((await api('GET', '/api/gibtsnicht')).status, 404);
  const big = await api('POST', `/api/trips/${trip.id}/items`, 'x'.repeat(10));
  assert.notEqual(big.status, 200);
});

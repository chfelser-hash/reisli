// API-Tests gegen einen echten Server (leerer Datenordner, erfundene Daten)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, apiClient, seed, day } from './helpers.js';

let srv, api, trip, items;

before(async () => {
  srv = await startServer();
  api = apiClient(srv.base);
  ({ trip, items } = await seed(api));
});
after(async () => srv?.stop());

test('ohne Anmeldung kein Zugriff, Schreiben nur mit X-Reisli-Header', async () => {
  const anon = apiClient(srv.base);
  assert.equal((await anon('GET', '/api/data')).status, 401);
  const res = await fetch(srv.base + '/api/trips', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.notEqual(res.status, 200);
});

test('Posten mit Browser-ID: doppelt gesendet wird nur einmal angelegt (Offline-Nachsenden)', async () => {
  const body = { id: 'ctest12345abc', date: day(0), title: 'Streetfood', catId: 'essen', plan: { amount: 120, currency: 'THB' }, payWhere: 'vorort' };
  const a = await api('POST', `/api/trips/${trip.id}/items`, body);
  const b = await api('POST', `/api/trips/${trip.id}/items`, body);
  assert.equal(a.status, 200);
  assert.equal(b.data.created[0].id, 'ctest12345abc');
  const { data } = await api('GET', '/api/data');
  assert.equal(data.trips[0].items.filter((x) => x.id === 'ctest12345abc').length, 1);
});

test('Änderung auf veraltetem Stand → 409 mit aktuellem Posten', async () => {
  const it = items[1];
  const first = await api('PUT', `/api/trips/${trip.id}/items/${it.id}`, { ...it, note: 'Gerät A' });
  assert.equal(first.status, 200);
  const stale = await api('PUT', `/api/trips/${trip.id}/items/${it.id}`, { ...it, note: 'Gerät B', baseUpdatedAt: it.createdAt });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.item.note, 'Gerät A');
});

test('Löschen eines nicht (mehr) vorhandenen Postens ist kein Fehler', async () => {
  assert.equal((await api('DELETE', `/api/trips/${trip.id}/items/gibtsnicht1`)).status, 200);
});

test('Bargeld: Bezug idempotent, ungültige Beträge abgelehnt', async () => {
  const e = { id: 'ccash0000001', kind: 'bezug', date: day(0), amount: 5000, currency: 'THB', chf: 131 };
  await api('POST', `/api/trips/${trip.id}/cash`, e);
  await api('POST', `/api/trips/${trip.id}/cash`, e);
  assert.equal((await api('POST', `/api/trips/${trip.id}/cash`, { kind: 'bezug', amount: 0, currency: 'THB' })).status, 400);
  // ohne CHF-Betrag bleibt er leer (nicht 0)
  const noChf = await api('POST', `/api/trips/${trip.id}/cash`, { kind: 'bezug', date: day(0), amount: 100, currency: 'THB', chf: null });
  assert.equal(noChf.data.entry.chf, null);
  await api('DELETE', `/api/trips/${trip.id}/cash/${noChf.data.entry.id}`);
  const { data } = await api('GET', '/api/data');
  assert.equal(data.trips[0].cash.length, 1);
});

test('Packliste: anlegen, abhaken, löschen', async () => {
  const { data } = await api('POST', `/api/trips/${trip.id}/packing`, [{ text: 'Pass', who: 'Anna' }, { text: 'Sonnencreme' }]);
  assert.equal(data.created.length, 2);
  const x = data.created[0];
  const put = await api('PUT', `/api/trips/${trip.id}/packing/${x.id}`, { ...x, done: true });
  assert.equal(put.data.item.done, true);
  await api('DELETE', `/api/trips/${trip.id}/packing/${data.created[1].id}`);
  const after = (await api('GET', '/api/data')).data.trips[0].packing;
  assert.deepEqual(after.map((p) => [p.text, p.done]), [['Pass', true]]);
});

test('Reisedokumente: anlegen mit Datei, Datei abrufbar, in der Sicherung enthalten', async () => {
  const { data } = await api('POST', '/api/documents', { title: 'Pass', kind: 'pass', person: 'Anna', number: 'X123', validUntil: day(400) });
  const doc = data.document;
  const up = await api('POST', `/api/documents/${doc.id}/files`, new TextEncoder().encode('Bilddaten'), { 'Content-Type': 'image/jpeg', 'X-File-Name': 'pass.jpg' });
  assert.equal(up.status, 200);
  const file = await api('GET', '/api/files/' + up.data.file.id);
  assert.equal(file.data, 'Bilddaten');
  const backup = (await api('GET', '/api/backup?files=1')).data;
  assert.equal(backup.documents.length, 1);
  assert.ok(backup.files[up.data.file.id]);
});

test('Reise löschen legt vorher eine Sicherung an', async () => {
  const { data } = await api('POST', '/api/trips', { name: 'Wegwerfreise', start: day(30), end: day(35), currency: 'EUR' });
  const del = await api('DELETE', '/api/trips/' + data.trip.id);
  assert.match(del.data.backup, /vor-loeschen-Wegwerfreise/);
});

test('Version: /api/status, /api/rev und Service Worker kennen die Version', async () => {
  const st = await (await fetch(srv.base + '/api/status')).json();
  assert.match(st.version, /^\d+\.\d+\.\d+$/);
  assert.equal((await api('GET', '/api/rev')).data.version, st.version);
  const sw = await (await fetch(srv.base + '/sw.js')).text();
  assert.ok(sw.includes(`reisli-shell-${st.version}`));
  const log = (await api('GET', '/api/changelog')).data;
  assert.equal(log.changelog[0].version, st.version);
});

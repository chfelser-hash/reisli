// Tests der Server-Bausteine ohne laufenden Server: Excel-Import, Kurse, Prüfung der Eingaben, Datenspeicher.
// Nur erfundene Daten (die Test-Excel erzeugt test/fixtures/make-beispiel-excel.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importTripFromExcel, applySettingsPatch, guessCategory, slug } from '../server/excel-import.js';
import { toChfPerUnit, applyRates, describeFetchError, fetchRates } from '../server/rates.js';
import { cleanItem, cleanTripMeta, cleanSettings, cleanCash, cleanDocument, cleanPackItem, cleanRepayment, cleanTrip, cleanDay } from '../server/clean.js';
import { Store, migrate } from '../server/store.js';
import { Auth } from '../server/auth.js';
import { tripSummary } from '../public/js/calc.js';

const FIXTURE = new URL('./fixtures/Beispielreise2030.xlsx', import.meta.url);
const throwsStatus = (fn, status) => assert.throws(fn, (e) => e.status === status);

// ---------- Excel-Import ----------
test('Excel-Import: Reise, Daten, Währung und Personen', () => {
  let i = 0;
  const r = importTripFromExcel(fs.readFileSync(FIXTURE), { fileName: 'Beispielreise2030.xlsx', settings: { methods: [], rates: {} }, newId: () => 'id' + i++ });
  const t = r.trip;
  assert.equal(t.name, 'Beispielreise 2030');
  assert.equal(t.start, '2030-03-01');
  assert.equal(t.end, '2030-03-05');
  assert.equal(t.currency, 'EUR'); // häufigste Fremdwährung
  assert.equal(t.travelers, 2); // aus «pro Person = B3/2»
  assert.deepEqual(t.days['2030-03-01'], { title: 'Anreise', place: 'Lissabon', note: 'Flug am Morgen', skip: [] });
  assert.deepEqual(r.settingsPatch, { methods: [{ id: 'm-testkarte', name: 'Testkarte' }], rates: { EUR: 0.95 } });
  assert.equal(r.report.excelTotal, 591);
  assert.equal(r.report.excelPaid, 420);
});

test('Excel-Import: Posten, Unterkünfte zusammengefasst, Zahlungen, Status', () => {
  let i = 0;
  const { trip, report } = importTripFromExcel(fs.readFileSync(FIXTURE), { fileName: 'x.xlsx', settings: { methods: [], rates: {} }, newId: () => 'id' + i++ });
  const by = Object.fromEntries(trip.items.map((x) => [x.title, x]));
  // bezahlt → Zahlung mit CHF aus der Excel, Uhrzeit aus der Spalte «Unterkunft»
  assert.equal(by['Flug Zürich–Lissabon'].payments.length, 1);
  assert.equal(by['Flug Zürich–Lissabon'].payments[0].chf, 420);
  assert.equal(by['Flug Zürich–Lissabon'].time, '07:15');
  // zwei Nächte Hotel Sol → eine Unterkunft bis zum Folgetag der letzten Nacht
  assert.equal(by['Hotel Sol'].date, '2030-03-01');
  assert.equal(by['Hotel Sol'].endDate, '2030-03-03');
  assert.equal(by['Hotel Sol'].catId, 'unterkunft');
  assert.equal(by['Hotel Sol'].reserved, true);
  assert.equal(by['Casa Mar'].endDate, '2030-03-05');
  // vor Ort, Link aus dem Kommentar
  assert.equal(by['Stadtführung'].payWhere, 'vorort');
  assert.equal(by['Stadtführung'].link, 'https://example.org/tour');
  assert.equal(by['Tauchen 2 Tauchgänge'].catId, 'tauchen');
  // angezahlt ohne Betrag → To-do und Warnung
  assert.equal(by['Mietauto'].todos.length, 1);
  assert.ok(report.warnings.some((w) => /Mietauto/.test(w)));
  // Zeile ausserhalb der Reise wird gemeldet UND nicht übernommen
  assert.ok(report.warnings.some((w) => /ausserhalb der Reise/.test(w)));
  assert.equal(by['Ausserhalb'], undefined);
  // Pauschalen: Essen nur an Tagen, an denen es in der Excel stand; Unterkunft-Platzhalter durch Hotels ersetzt
  const essen = trip.allowances.find((a) => a.label === 'Essen & Trinken');
  assert.equal(essen.mode, 'tag');
  assert.ok(!trip.days['2030-03-01'].skip.includes(essen.id));
  assert.ok(trip.days['2030-03-02'].skip.includes(essen.id));
  // Prognose lässt sich berechnen
  const sum = tripSummary({ rates: { EUR: { rate: 0.95 } } }, trip, '2030-01-01');
  assert.ok(sum.forecast > 900);
});

test('Excel-Import: keine Ferien-Excel → verständlicher Fehler', () => {
  assert.throws(() => importTripFromExcel(Buffer.from('kein Excel'), { settings: {}, newId: () => 'x' }));
});

test('Excel-Import: Methoden und Kurse übernehmen, Bestehendes bleibt', () => {
  const s = { methods: [{ id: 'k', name: 'Testkarte' }], rates: { EUR: { rate: 0.9, source: 'manuell' } } };
  const added = applySettingsPatch(s, { methods: [{ id: 'm-testkarte', name: 'testkarte' }, { id: 'm-bar', name: 'Bar' }], rates: { EUR: 0.95, USD: 0.8 } });
  assert.deepEqual(added, { methods: ['Bar'], rates: ['USD'] });
  assert.equal(s.rates.EUR.rate, 0.9);
  assert.equal(guessCategory('Fähre nach Koh Tao'), 'transport');
  assert.equal(guessCategory('Eintritt Nationalpark NP'), 'gebuehren');
  assert.equal(slug('Kreditkarte Über'), 'kreditkarte-ueber');
});

// ---------- Kurse ----------
test('Kurse: Umrechnung «Einheiten pro CHF» → «CHF pro Einheit», fixe Kurse bleiben', () => {
  const f = toChfPerUnit('2030-01-02', { EUR: 1.05, THB: 40, bad: 3, ZZZ: -1 });
  assert.equal(f.date, '2030-01-02');
  assert.ok(Math.abs(f.rates.THB - 0.025) < 1e-12);
  assert.equal(f.rates.ZZZ, undefined);
  assert.match(toChfPerUnit('kaputt', {}).date, /^\d{4}-\d{2}-\d{2}$/);
  const s = { rates: { EUR: { rate: 1 }, THB: { rate: 0.03, locked: true }, XYZ: { rate: 1 } } };
  const r = applyRates(s, f);
  assert.deepEqual(r.updated, ['EUR']);
  assert.deepEqual(r.missing, ['XYZ']);
  assert.equal(s.rates.THB.rate, 0.03);
  assert.match(s.rates.EUR.source, /^EZB/);
});

test('Kurse: Abruf über fetch (Ersatzdienst, Fehlermeldungen)', async () => {
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ date: '2030-01-02', rates: { EUR: 1.25 } }) });
    assert.equal((await fetchRates()).rates.EUR, 0.8);
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(fetchRates(), /503/);
    globalThis.fetch = async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
    await assert.rejects(fetchRates());
  } finally {
    globalThis.fetch = orig;
  }
  assert.match(describeFetchError({ cause: { code: 'SELF_SIGNED_CERT_IN_CHAIN' } }), /Zertifikat/);
  assert.equal(describeFetchError({ name: 'AbortError' }), 'Zeitüberschreitung');
  assert.equal(describeFetchError({}), 'unbekannter Fehler');
});

// ---------- Eingaben prüfen ----------
test('Eingaben: Posten, Reise, Tage werden geprüft und bereinigt', () => {
  throwsStatus(() => cleanItem({ date: 'gestern', title: 'x' }), 400);
  throwsStatus(() => cleanItem({ date: '2030-01-01', title: '  ' }), 400);
  const it = cleanItem({ date: '2030-01-01', endDate: '2029-12-31', title: 'Hotel', time: '25:99x', link: 'javascript:alert(1)', plan: { amount: '12.345', currency: 'eur' }, payWhere: 'irgendwo', split: { mode: 'equal', members: ['a'] } }, { name: 'Anna' });
  assert.equal(it.endDate, ''); // Ende vor Start verworfen
  assert.equal(it.time, '');
  assert.equal(it.link, ''); // nur http(s)
  assert.deepEqual(it.plan, { amount: 12.35, currency: 'CHF' });
  assert.equal(it.payWhere, 'vorgaengig');
  assert.equal(it.by, 'Anna');
  assert.equal(it.split.mode, 'equal');
  throwsStatus(() => cleanTripMeta({ name: 'x', start: '2030-02-01', end: '2030-01-01' }), 400);
  throwsStatus(() => cleanTripMeta({ name: 'x', start: '2030-01-01', end: '2031-06-01' }), 400);
  throwsStatus(() => cleanTripMeta({ name: ' ', start: '2030-01-01', end: '2030-01-02' }), 400);
  assert.equal(cleanDay({ currency: 'thb', skip: ['a'] }).currency, '');
  const t = cleanTrip({ name: 'T', start: '2030-01-01', end: '2030-01-03', items: [{ date: '2030-01-01', title: 'A' }], repayments: [{ amount: -1 }], cash: [{ kind: 'bezug', amount: 0 }], packing: [{ text: '' }, { text: 'Pass' }] }, { name: 'Anna' });
  assert.equal(t.items.length, 1);
  assert.equal(t.repayments.length, 0); // ungültige übersprungen
  assert.equal(t.cash.length, 0);
  assert.deepEqual(t.packing.map((p) => p.text), ['Pass']);
});

test('Eingaben: Bargeld, Rückzahlung, Dokument, Packliste, Einstellungen', () => {
  throwsStatus(() => cleanCash({ kind: 'korrektur', amount: 0 }), 400);
  assert.equal(cleanCash({ kind: 'korrektur', amount: -50, chf: 3 }).chf, null); // Korrektur ohne CHF
  assert.equal(cleanCash({ kind: 'unsinn', amount: 5 }).kind, 'bezug');
  throwsStatus(() => cleanRepayment({ amount: 10, from: 'a', to: 'a' }), 400);
  throwsStatus(() => cleanDocument({ title: '' }), 400);
  assert.equal(cleanDocument({ title: 'Brevet', kind: 'brevet', issued: '2012' }).issued, '2012');
  assert.equal(cleanDocument({ title: 'Brevet', kind: 'brevet', issued: '12.5.2012' }).issued, '');
  assert.equal(cleanDocument({ title: 'X', kind: 'erfunden' }).kind, 'sonstiges');
  throwsStatus(() => cleanPackItem({ text: ' ' }), 400);
  const s = cleanSettings({
    methods: [{ id: 'bar', name: 'Bar', cash: true }, { name: '' }],
    categories: [{ name: 'Essen', color: 'rot' }],
    rates: { EUR: { rate: 0.95 }, CHF: { rate: 1 }, bad: { rate: 1 }, USD: { rate: -1 } },
    packTemplates: [{ name: '', items: [{ text: 'Pass', perPerson: 1 }, { text: '' }] }],
  }, {});
  assert.deepEqual(s.methods, [{ id: 'bar', name: 'Bar', cash: true }]);
  assert.equal(s.categories[0].color, '#64748b');
  assert.deepEqual(Object.keys(s.rates), ['EUR']);
  assert.equal(s.packTemplates[0].name, 'Vorlage');
  assert.deepEqual(s.packTemplates[0].items, [{ text: 'Pass', group: '', perPerson: true }]);
  throwsStatus(() => cleanSettings({ categories: [{ name: '' }] }, {}), 400);
});

// ---------- Datenspeicher ----------
test('Speicher: Migration ergänzt fehlende Felder, teilt alte Kategorie «Tauchen» einmalig auf', () => {
  const d = migrate({ trips: [{ id: 't', items: [{ title: 'x' }] }], documents: [{ title: 'DAN Versicherung', kind: 'tauchen' }, { title: 'PADI OWD', kind: 'tauchen' }] });
  const t = d.trips[0];
  assert.deepEqual([t.repayments, t.cash, t.packing, t.items[0].payments], [[], [], [], []]);
  assert.deepEqual(d.documents.map((x) => x.kind), ['versicherung', 'brevet']);
  assert.equal(d.docsSchema, 2);
  // neue «Tauchen – Sonstiges» bleiben danach, wie sie sind
  d.documents.push({ title: 'Logbuch', kind: 'tauchen', files: [] });
  assert.equal(migrate(d).documents[2].kind, 'tauchen');
  assert.ok(d.settings.categories.length > 3);
});

test('Speicher: schreibt atomar, Sicherungen anlegen, auflisten, lesen, ersetzen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reisli-store-'));
  try {
    const s = new Store(dir);
    s.mutate((d) => d.trips.push({ id: 'a', name: 'A', items: [] }));
    const name = s.snapshot('test');
    assert.ok(s.listBackups().some((b) => b.name === name));
    assert.equal(s.readBackup(name).trips.length, 1);
    s.replaceAll({ trips: [], settings: {} });
    assert.equal(s.data.trips.length, 0);
    assert.ok(s.listBackups().some((b) => /vor-wiederherstellung/.test(b.name)));
    assert.equal(new Store(dir).data.trips.length, 0); // neu laden
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Anmeldung: Passwortregeln, Sperre nach Fehlversuchen, Sitzung', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reisli-auth-'));
  try {
    const a = new Auth(dir);
    throwsStatus(() => a.createUser('Anna', 'kurz'), 400);
    const u = a.createUser('Anna', 'geheim123');
    throwsStatus(() => a.createUser('anna', 'geheim123'), 400);
    for (let i = 0; i < 8; i++) throwsStatus(() => a.login('Anna', 'falsch', '1.2.3.4'), 401);
    throwsStatus(() => a.login('Anna', 'geheim123', '1.2.3.4'), 429); // gesperrt
    const { token } = a.login('anna', 'geheim123', '5.6.7.8'); // andere Adresse, Name ohne Gross/klein
    assert.equal(a.userForToken(token).name, 'Anna');
    throwsStatus(() => a.changePassword(u.id, 'falsch', 'neuesPasswort'), 400);
    a.changePassword(u.id, 'geheim123', 'neuesPasswort');
    throwsStatus(() => a.deleteUser(u.id, u.id), 400);
    a.logout(token);
    assert.equal(a.userForToken(token), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

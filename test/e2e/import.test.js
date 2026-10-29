// Buchung importieren im Browser: einfügen bzw. Datei wählen, Feld für Feld übernehmen, Storno, Flüge.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { startServer, apiClient, seed } from './helpers.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const MAILS = new URL('../fixtures/mails/', import.meta.url);
const T = { timeout: 90000 };
let srv, api, browser, page, tripId;
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const items = async () => (await api('GET', '/api/data')).data.trips.find((t) => t.id === tripId).items;

before(async () => {
  srv = await startServer();
  api = apiClient(srv.base);
  await seed(api);
  // Reise passend zu den Beispiel-Mails (Februar 2027)
  tripId = (await api('POST', '/api/trips', { name: 'Thailand', start: '2027-02-10', end: '2027-03-01', currency: 'THB' })).data.trip.id;
  browser = await chromium.launch();
  page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(srv.base);
  await page.fill('input[name=name]', 'Anna');
  await page.fill('input[name=password]', 'geheim123');
  await page.click('button[type=submit]');
  await page.waitForSelector('.view');
  await page.evaluate((id) => localStorage.setItem('reisli.trip', id), tripId);
});
after(async () => {
  await browser?.close();
  await srv?.stop();
});

async function openImport() {
  await page.goto(srv.base + '/#plan');
  await page.waitForSelector('.view.plan');
  await page.click('button:has-text("Buchung importieren")');
  await page.waitForSelector('dialog[open] .import-src');
}

test('Booking.com: Text einfügen → neue Unterkunft mit allen Feldern und Beleg', T, async () => {
  await openImport();
  await page.fill('dialog[open] textarea', fs.readFileSync(new URL('booking-de.txt', MAILS), 'utf8'));
  await page.click('dialog[open] button:has-text("Erkennen")');
  await page.waitForSelector('dialog[open] .import-review');
  assert.equal(await page.inputValue('dialog[open] .import-trip select'), tripId); // Reise anhand des Datums vorgeschlagen
  assert.equal(await page.inputValue('dialog[open] [data-val="title"]'), 'Riverside Boutique Hotel');
  // ein Feld abwählen: Telefon nicht übernehmen
  await page.uncheck('dialog[open] input[data-key="phone"]');
  await page.selectOption('dialog[open] [data-val="payment"]', 'vorort');
  await page.click('dialog[open] footer button:has-text("Übernehmen")');
  await page.waitForSelector('dialog[open]', { state: 'detached' });
  const it = (await items()).find((x) => x.bookingRef === '4711.123.456');
  assert.equal(it.title, 'Riverside Boutique Hotel');
  assert.equal(it.date, '2027-02-12');
  assert.equal(it.endDate, '2027-02-15');
  assert.equal(it.catId, 'unterkunft');
  assert.deepEqual(it.plan, { amount: 9450, currency: 'THB' });
  assert.equal(it.payWhere, 'vorort');
  assert.equal(it.phone, ''); // abgewählt
  assert.match(it.address, /Charoen Krung/);
  assert.match(it.note, /PIN 8642/);
  assert.equal(it.todos[0].due, '2027-02-10');
  assert.equal(it.files.length, 1);
});

test('Gleiche Buchung nochmals (.eml): wird aktualisiert statt doppelt angelegt', T, async () => {
  await openImport();
  await page.setInputFiles('dialog[open] input[type=file]', new URL('booking-en.eml', MAILS).pathname);
  await page.click('dialog[open] button:has-text("Erkennen")');
  await page.waitForSelector('dialog[open] .import-review');
  assert.match(await page.textContent('dialog[open] .import-review'), /Bekannte Buchung/);
  // Telefon war leer → jetzt vorausgewählt; Name unverändert → nicht vorausgewählt
  assert.equal(await page.isChecked('dialog[open] input[data-key="phone"]'), true);
  assert.equal(await page.isChecked('dialog[open] input[data-key="title"]'), false);
  await page.click('dialog[open] footer button:has-text("Übernehmen")');
  await page.waitForSelector('dialog[open]', { state: 'detached' });
  const list = (await items()).filter((x) => x.bookingRef === '4711.123.456');
  assert.equal(list.length, 1);
  assert.equal(list[0].phone, '+66 2 123 4567');
  assert.equal(list[0].files.length, 2);
});

test('Stornierung: Posten als storniert markieren', T, async () => {
  await openImport();
  await page.fill('dialog[open] textarea', fs.readFileSync(new URL('booking-storno-de.txt', MAILS), 'utf8'));
  await page.click('dialog[open] button:has-text("Erkennen")');
  await page.waitForSelector('dialog[open] input[name=storno]');
  await page.click('dialog[open] footer button:has-text("Übernehmen")');
  await page.waitForSelector('dialog[open]', { state: 'detached' });
  const it = (await items()).find((x) => x.bookingRef === '4711.123.456');
  assert.equal(it.plan.amount, 0);
  assert.match(it.note, /storniert/);
});

test('SWISS: zwei Flüge, Preis und Zahlung beim ersten', T, async () => {
  const S = (await api('GET', '/api/data')).data.settings;
  await openImport();
  await page.fill('dialog[open] textarea', fs.readFileSync(new URL('swiss-de.txt', MAILS), 'utf8'));
  await page.click('dialog[open] button:has-text("Erkennen")');
  await page.waitForSelector('dialog[open] [data-seg-title="0"]');
  await page.selectOption('dialog[open] [data-val="method"]', S.methods.find((m) => m.id !== 'bar').id);
  await page.click('dialog[open] footer button:has-text("Übernehmen")');
  await page.waitForSelector('dialog[open]', { state: 'detached' });
  const flights = (await items()).filter((x) => x.catId === 'flug').sort((a, b) => a.date.localeCompare(b.date));
  assert.deepEqual(flights.map((f) => [f.title, f.date, f.time, f.detail]), [
    ['LX 180 ZRH → BKK', '2027-02-12', '22:40', 'an 15:25 (+1)'],
    ['LX 181 BKK → ZRH', '2027-02-28', '23:35', 'an 06:15 (+1)'],
  ]);
  assert.deepEqual(flights[0].plan, { amount: 1846.3, currency: 'CHF' });
  assert.equal(flights[0].payments.length, 1);
  assert.equal(flights[1].plan.amount, 0);
  assert.equal(flights[0].bookingRef, 'K7XQ2P');
});

test('Abbrechen übernimmt nichts; keine JavaScript-Fehler', T, async () => {
  const n = (await items()).length;
  await openImport();
  await page.fill('dialog[open] textarea', fs.readFileSync(new URL('agoda-en.txt', MAILS), 'utf8'));
  await page.click('dialog[open] button:has-text("Erkennen")');
  await page.waitForSelector('dialog[open] .import-review');
  await page.click('dialog[open] footer button:has-text("Abbrechen")');
  await sleep(300);
  assert.equal((await items()).length, n);
  assert.deepEqual(errors, []);
});

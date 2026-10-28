// Browser-Tests (Chromium über Playwright): die wichtigsten Abläufe wie von Hand – auf Handy-Grösse.
// Bei einem Fehler landet ein Bildschirmfoto in test-results/ (nur erfundene Daten).
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { startServer, apiClient, seed } from './helpers.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

let srv, api, trip, browser, ctx, page;
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = { timeout: 90000 };

/** Wartet, bis die Offline-Warteschlange leer ist */
async function waitSynced() {
  for (let i = 0; i < 60; i++) {
    const txt = (await page.textContent('#net-badge').catch(() => '')) || '';
    if (!/wartend/.test(txt)) return;
    await sleep(500);
  }
  throw new Error('Warteschlange wurde nicht übertragen');
}
const serverTrip = async () => (await api('GET', '/api/data')).data.trips.find((x) => x.id === trip.id);

before(async () => {
  srv = await startServer();
  api = apiClient(srv.base);
  ({ trip } = await seed(api));
  browser = await chromium.launch();
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
});
after(async () => {
  await browser?.close();
  await srv?.stop();
});
afterEach(async (t) => {
  if (!page) return;
  fs.mkdirSync('test-results', { recursive: true });
  const name = (t?.name || 'test').replace(/[^\w-]+/g, '_').slice(0, 60);
  await page.screenshot({ path: `test-results/${name}.png`, fullPage: true }).catch(() => {});
});

test('Anmelden: «Heute» zeigt die laufende Reise', T, async () => {
  await page.goto(srv.base);
  await page.fill('input[name=name]', 'Anna');
  await page.fill('input[name=password]', 'geheim123');
  await page.click('button[type=submit]');
  await page.waitForSelector('.heute');
  assert.match(await page.textContent('.th-kicker'), /Tag 4 von 11/);
  assert.match(await page.textContent('.heute'), /Hotel am Fluss/);
  // Service Worker muss die Seite kontrollieren, sonst gibt es keinen Offline-Modus
  await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 }).catch(async () => {
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 });
  });
});

test('Ausgabe erfassen (online)', T, async () => {
  await page.goto(srv.base + '/#erfassen');
  await page.waitForSelector('.amount-input');
  await page.fill('.amount-input', '150+50');
  await page.click('form.entry button[type=submit]');
  await sleep(500);
  const t = await serverTrip();
  assert.ok(t.items.some((x) => x.plan.amount === 200 && x.plan.currency === 'THB'));
});

test('Offline: erfassen, neu laden, nach dem Verbinden übertragen', T, async () => {
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('.view');
  assert.match(await page.textContent('#net-badge'), /Offline/);
  await page.goto(srv.base + '/#erfassen');
  await page.waitForSelector('.amount-input');
  await page.fill('.amount-input', '333');
  await page.click('form.entry button[type=submit]');
  await sleep(400);
  assert.match(await page.textContent('#net-badge'), /1 wartend/);
  await page.reload(); // Warteschlange überlebt einen Neustart der App
  await page.waitForSelector('.view');
  assert.match(await page.textContent('#net-badge'), /1 wartend/);
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitSynced();
  const t = await serverTrip();
  assert.ok(t.items.some((x) => x.plan.amount === 333));
});

test('Konflikt: offline geändert, inzwischen auf anderem Gerät geändert', T, async () => {
  await page.goto(srv.base + '/#heute');
  await page.waitForSelector('.heute');
  await ctx.setOffline(true);
  await page.click('.ag-title:has-text("Abendessen")');
  await page.waitForSelector('dialog[open]');
  await page.fill('dialog[open] textarea', 'Tisch am Fenster');
  await page.click('dialog[open] footer button:has-text("Speichern")');
  await sleep(300);
  // anderes Gerät
  const t = await serverTrip();
  const it = t.items.find((x) => x.title === 'Abendessen');
  await api('PUT', `/api/trips/${trip.id}/items/${it.id}`, { ...it, note: 'anderes Gerät' });
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitSynced();
  await page.waitForFunction(() => /Konflikt/.test(document.querySelector('#net-badge')?.textContent || ''));
  await page.click('#net-badge');
  await page.click('dialog[open] button:has-text("Meine übernehmen")');
  await sleep(500);
  await page.click('dialog[open] footer button:has-text("Schliessen")');
  const t2 = await serverTrip();
  assert.equal(t2.items.find((x) => x.title === 'Abendessen').note, 'Tisch am Fenster');
});

test('Bargeld: Bezug, bar bezahlen zum Bezugskurs, Kassensturz abbrechen bucht nichts', T, async () => {
  await page.goto(srv.base + '/#heute');
  await page.waitForSelector('.wallet');
  await page.click('.wallet button:has-text("+ Bezug")');
  await page.fill('dialog[open] input[placeholder="z.B. 5000"]', '10000');
  await page.fill('dialog[open] input[placeholder^="laut Beleg"]', '262');
  await page.click('dialog[open] footer button:has-text("Speichern")');
  await sleep(300);
  assert.match(await page.textContent('.wallet .pot-balance'), /10.000 THB/);
  await page.goto(srv.base + '/#erfassen');
  await page.fill('.amount-input', '1000');
  await page.click('.chip:has-text("Bar")');
  assert.match(await page.textContent('.cash-hint'), /Im Portemonnaie/);
  await page.click('form.entry button[type=submit]');
  await sleep(400);
  const t = await serverTrip();
  const pay = t.items.find((x) => x.plan.amount === 1000).payments[0];
  assert.equal(pay.chf, 26.2); // 1000 × 262/10000
  await page.goto(srv.base + '/#heute');
  await page.click('.wallet button:has-text("Kassensturz")');
  await page.fill('dialog[open] .amount-input', '8000');
  await page.click('dialog[open] footer button:has-text("Abbrechen")');
  await sleep(300);
  assert.equal((await serverTrip()).cash.length, 1);
});

test('Packliste aus Vorlage, offline abhaken', T, async () => {
  await page.goto(srv.base + '/#offen');
  await page.click('.seg:has-text("Packliste")');
  await page.click('text=Packliste anlegen');
  await page.waitForSelector('.pack-row');
  const n = await page.locator('.pack-row').count();
  assert.ok(n > 20);
  await ctx.setOffline(true);
  await page.locator('.pack-row input[type=checkbox]').nth(0).check();
  await page.locator('.pack-row input[type=checkbox]').nth(1).check();
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitSynced();
  assert.equal((await serverTrip()).packing.filter((x) => x.done).length, 2);
});

test('Reisedokumente: anlegen, gruppiert, einklappbar', T, async () => {
  await page.goto(srv.base + '/#dokumente');
  await page.click('text=+ Dokument');
  await page.fill('dialog[open] input[placeholder^="z.B. Pass"]', 'Pass');
  await page.fill('dialog[open] input[placeholder^="Pass-"]', 'X0000001');
  await page.click('dialog[open] footer button:has-text("Speichern")');
  await page.waitForSelector('details.doc-group[data-kind=pass]');
  await sleep(300);
  await page.click('details.doc-group[data-kind=pass] > summary');
  await sleep(200);
  await page.reload(); // eingeklappt bleibt eingeklappt
  await page.waitForSelector('details.doc-group[data-kind=pass]');
  assert.equal(await page.evaluate(() => document.querySelector('details.doc-group[data-kind=pass]').open), false);
  const docs = (await api('GET', '/api/data')).data.documents;
  assert.equal(docs[0].number, 'X0000001');
});

test('Umrechnen: THB → CHF', T, async () => {
  await page.click('.calc-btn');
  await page.fill('dialog[open] .calc-in >> nth=0', '1000');
  const chf = await page.inputValue('dialog[open] .calc-in >> nth=1');
  assert.ok(['25.00', '26.20'].includes(chf), chf); // Tageskurs oder Bezugskurs
  await page.click('dialog[open] footer button:has-text("Schliessen")');
});

test('keine JavaScript-Fehler', () => {
  assert.deepEqual(errors, []);
});

// Neue Reise: Von–Bis im Kalender antippen (wie in Flux), ohne Datumsfelder
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer, apiClient, seed, day } from './helpers.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
let srv, api, browser;

before(async () => {
  srv = await startServer();
  api = apiClient(srv.base);
  await seed(api);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await srv?.stop();
});

test('Neue Reise: ersten und letzten Tag im Kalender antippen, über den Monatswechsel', { timeout: 60000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(srv.base + '/#plan');
  await page.fill('input[name=name]', 'Anna');
  await page.fill('input[name=password]', 'geheim123');
  await page.click('button[type=submit]');
  await page.click('.trip-btn');
  await page.click('text=+ Neue Reise …');
  await page.waitForSelector('dialog[open] .rcal');
  await page.fill('dialog[open] input[placeholder="z.B. Japan"]', 'Island');
  // Start: 15. des übernächsten Monats; Ende: 3. des Monats danach
  const base = new Date();
  const ym = (k) => { const d = new Date(Date.UTC(base.getFullYear(), base.getMonth() + k, 1)); return d.toISOString().slice(0, 7); };
  const from = `${ym(2)}-15`, to = `${ym(3)}-03`;
  for (let i = 0; i < 24 && (await page.getAttribute('dialog[open] .rcal', 'data-month')) !== ym(2); i++) await page.click(`dialog[open] .rcal-${(await page.getAttribute('dialog[open] .rcal', 'data-month')) < ym(2) ? 'next' : 'prev'}`);
  await page.click(`dialog[open] .rcal-day[data-date="${from}"]`);
  assert.equal(await page.getAttribute('dialog[open] .rcal', 'data-picking'), 'to');
  await page.click('dialog[open] .rcal-next');
  await page.click(`dialog[open] .rcal-day[data-date="${to}"]`);
  assert.equal(await page.getAttribute('dialog[open] .rcal', 'data-picking'), 'from');
  assert.match(await page.textContent('dialog[open] .rcal-hint'), /Nächte/);
  // Tage der bestehenden Testreise sind markiert (anderer Monat → hier keine)
  await page.click('dialog[open] button:has-text("Reise anlegen")');
  await page.waitForSelector('dialog[open]', { state: 'detached' });
  const t = (await api('GET', '/api/data')).data.trips.find((x) => x.name === 'Island');
  assert.equal(t.start, from);
  assert.equal(t.end, to);
  assert.deepEqual(errors, []);
});

test('Kalender markiert Tage bestehender Reisen', { timeout: 60000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(srv.base + '/#plan');
  await page.fill('input[name=name]', 'Anna');
  await page.fill('input[name=password]', 'geheim123');
  await page.click('button[type=submit]');
  await page.click('.trip-btn');
  await page.click('text=+ Neue Reise …');
  await page.waitForSelector('dialog[open] .rcal');
  const target = day(0).slice(0, 7);
  for (let i = 0; i < 24 && (await page.getAttribute('dialog[open] .rcal', 'data-month')) !== target; i++) await page.click('dialog[open] .rcal-prev');
  assert.ok(await page.$(`dialog[open] .rcal-day.rcal-busy[data-date="${day(0)}"]`)); // Testreise läuft heute
});

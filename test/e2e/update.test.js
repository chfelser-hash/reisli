// «Nach Updates suchen / Aktualisieren» über API und Oberfläche – mit lokalem Git-Repo als «GitHub»
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { makeRepos } from '../git-helpers.js';
import { startServer, apiClient, seed } from './helpers.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const [ma, mi] = pkg.version.split('.').map(Number);
const next = `${ma}.${mi + 1}.0`;
let repos, srv, api, browser;

before(async () => {
  repos = makeRepos([pkg.version, next]);
  process.env.UPDATE_ROOT = repos.clone;
  srv = await startServer();
  api = apiClient(srv.base);
  await seed(api);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await srv?.stop();
  repos?.cleanup();
});

test('API: neuere Version gefunden; ohne Anmeldung kein Zugriff', { timeout: 60000 }, async () => {
  assert.equal((await apiClient(srv.base)('GET', '/api/update')).status, 401);
  const c = (await api('GET', '/api/update')).data;
  assert.equal(c.current, pkg.version);
  assert.deepEqual(c.newer, [next]);
  assert.equal((await api('POST', '/api/update', { version: '0.0.1' })).status, 400);
});

test('Oberfläche: suchen, aktualisieren (vorher Sicherung), Hinweis zum Neustart', { timeout: 90000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(srv.base + '/#mehr');
  await page.fill('input[name=name]', 'Anna');
  await page.fill('input[name=password]', 'geheim123');
  await page.click('button[type=submit]');
  await page.click('button:has-text("Nach Updates suchen")');
  await page.waitForSelector(`text=Version ${next} verfügbar`);
  assert.match(await page.textContent('.update-box'), new RegExp(`Änderung in ${next.replace(/\./g, '\\.')}`));
  await page.click(`button:has-text("Jetzt auf ${next} aktualisieren")`);
  await page.click('dialog[open] footer button:has-text("Aktualisieren")');
  await page.waitForSelector('text=Bitte Reisli jetzt neu starten'); // im Test ohne Docker-Neustart
  assert.equal(repos.version(), next);
  const backups = (await api('GET', '/api/backups')).data.backups;
  assert.ok(backups.some((b) => b.name.startsWith('vor-update-' + next)));
  assert.deepEqual(errors, []);
});

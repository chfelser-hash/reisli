// Aktualisieren über die App: mit einem echten (lokalen) Git-Repo als «GitHub» – kein Netz nötig.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUpdater, cmpVersion, parseChangelog, MIN_VERSION } from '../server/update.js';

import { makeRepos, git } from './git-helpers.js';

test('Versionen vergleichen, Änderungsliste lesen', () => {
  assert.ok(cmpVersion('1.10.0', '1.9.9') > 0);
  assert.equal(cmpVersion('v1.3.0', '1.3.0'), 0);
  assert.ok(cmpVersion('1.2.9', MIN_VERSION) < 0);
  assert.deepEqual(parseChangelog('## 1.3.0 – 2030-01-02\n- a\n- b\n\n## 1.2.0 – 2030-01-01\n- c'), [
    { version: '1.3.0', date: '2030-01-02', changes: ['a', 'b'] },
    { version: '1.2.0', date: '2030-01-01', changes: ['c'] },
  ]);
});

test('Neue Version finden und einspielen, danach zurück', async () => {
  const r = makeRepos(['1.3.0', '1.3.1', '1.4.0']);
  try {
    const u = createUpdater({ root: r.clone, version: '1.3.0' });
    const c = await u.check();
    assert.equal(c.enabled, true);
    assert.deepEqual(c.newer, ['1.4.0', '1.3.1']);
    assert.equal(c.latest, 'v1.4.0');
    assert.deepEqual(c.changelog.map((x) => x.version), ['1.4.0', '1.3.1']); // nur neuere
    assert.deepEqual(c.dirty, []);
    await u.apply('1.4.0');
    assert.equal(r.version(), '1.4.0');
    // zurück auf eine frühere Version
    await createUpdater({ root: r.clone, version: '1.4.0' }).apply('1.3.1');
    assert.equal(r.version(), '1.3.1');
    // danach geht auch «git pull» von Hand wieder (Zweig ist nur zurückgesetzt)
    git(r.clone, 'pull', '-q', '--ff-only');
    assert.equal(r.version(), '1.4.0');
  } finally {
    r.cleanup();
  }
});

test('Schutz: unbekannte, zu alte oder ungültige Versionen, ausgeschaltet, kein Git-Ordner', async () => {
  const r = makeRepos(['1.2.0', '1.3.0']);
  try {
    const u = createUpdater({ root: r.clone, version: '1.3.0' });
    await u.check();
    await assert.rejects(u.apply('9.9.9'), /gibt es nicht/);
    await assert.rejects(u.apply('1.2.0'), /älter als/); // kennt den Update-Knopf noch nicht
    await assert.rejects(u.apply('main; rm -rf /'), /ungültig/);
    assert.equal((await u.check()).versions.includes('1.2.0'), false);
    // von Hand geänderte Datei wird gemeldet
    fs.writeFileSync(path.join(r.clone, 'CHANGELOG.md'), 'geändert');
    assert.deepEqual((await u.check()).dirty.length, 1);
  } finally {
    r.cleanup();
  }
  assert.equal((await createUpdater({ root: os.tmpdir(), version: '1.3.0' }).check()).enabled, false);
  const off = await createUpdater({ root: '.', version: '1.3.0', enabled: false }).check();
  assert.match(off.reason, /ausgeschaltet/);
});

test('GitHub nicht erreichbar → verständliche Meldung statt Fehler', async () => {
  const r = makeRepos(['1.3.0']);
  try {
    git(r.clone, 'remote', 'set-url', 'origin', path.join(r.dir, 'gibtsnicht.git'));
    const c = await createUpdater({ root: r.clone, version: '1.3.0' }).check();
    assert.equal(c.enabled, false);
    assert.match(c.reason, /nicht erreichbar/);
  } finally {
    r.cleanup();
  }
});
